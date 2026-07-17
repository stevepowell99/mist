/**
 * Local-fs sidecar for gmist's local mode: a tiny HTTP server on 127.0.0.1
 * that serves a folder on this machine to the dev worker, which runs in
 * workerd and cannot touch the host disk itself. The worker-side client is
 * app/lib/google-localfs.server.ts; ids and safety live there and in
 * app/lib/localfs-ids.ts. Configured by LOCAL_FS_ROOT and LOCAL_FS_URL in
 * .dev.vars (or env). Started by `npm run dev:local` (or standalone with
 * `npm run localfs`). Loopback-only; never expose it beyond this machine.
 *
 * Version tokens are content hashes, so a re-save of identical bytes keeps
 * the same version and only a genuine change trips the conflict machinery.
 * Deletes are recoverable: /trash moves into <root>/.gmist-trash.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { readDevVars } from "./dev-vars.mjs";

const vars = { ...readDevVars(), ...process.env };
if (!vars.LOCAL_FS_ROOT) {
  console.error("localfs: LOCAL_FS_ROOT is not set (add it to .dev.vars)");
  process.exit(1);
}
const ROOT = path.resolve(vars.LOCAL_FS_ROOT);
const PORT = Number(new URL(vars.LOCAL_FS_URL || "http://127.0.0.1:5199").port || 5199);
const TRASH = ".gmist-trash";

// Mirror of SLUDGE_DIRS in app/lib/google-drive.server.ts (this script cannot
// import the app's TS), plus local-only noise; dot-directories are skipped too.
const SLUDGE = new Set([
  ".quarto", "_freeze", "site_libs", "_site", "_book", "node_modules",
  ".git", ".obsidian", "_extensions", TRASH, ".trash", "_tmp",
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Resolve a root-relative path, refusing anything that escapes the root. */
function resolveSafe(rel) {
  if (rel == null) throw new HttpError(400, "missing path");
  if (rel.includes("\\") || rel.includes("\0")) throw new HttpError(400, "bad path");
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new HttpError(400, "path escapes root");
  return abs;
}

const hashOf = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function statOf(rel) {
  const abs = resolveSafe(rel);
  try {
    const st = await fs.stat(abs);
    return {
      exists: true,
      isFolder: st.isDirectory(),
      name: path.basename(abs),
      mtimeMs: st.mtimeMs,
      size: st.size,
      version: st.isDirectory() ? null : hashOf(await fs.readFile(abs)),
    };
  } catch {
    return { exists: false, isFolder: false, name: path.basename(abs), mtimeMs: 0, size: 0, version: null };
  }
}

function skippable(name) {
  return name.startsWith(".") || SLUDGE.has(name) || /_files$/.test(name) || name === "desktop.ini";
}

/** Direct children of a folder, folders first then by name, noise dropped. */
async function listDir(rel) {
  const abs = resolveSafe(rel);
  const dirents = await fs.readdir(abs, { withFileTypes: true }).catch(() => {
    throw new HttpError(404, `folder not found: ${rel || "(root)"}`);
  });
  return dirents
    .filter((d) => (d.isDirectory() || d.isFile()) && !skippable(d.name))
    .map((d) => ({ name: d.name, isFolder: d.isDirectory() }))
    .sort((a, b) => (a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
}

// Recursive index of the whole root for /search, cached briefly so a burst of
// quick-open keystrokes does not re-walk the tree each time.
const INDEX_TTL_MS = 15_000;
let index = null; // { builtAt, entries: [{relPath, name, isFolder, mtimeMs}] }

async function buildIndex() {
  const entries = [];
  async function walk(rel) {
    let dirents;
    try {
      dirents = await fs.readdir(path.resolve(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (skippable(d.name) || (!d.isDirectory() && !d.isFile())) continue;
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.stat(path.resolve(ROOT, childRel))).mtimeMs;
      } catch {
        continue;
      }
      entries.push({ relPath: childRel, name: d.name, isFolder: d.isDirectory(), mtimeMs });
      if (d.isDirectory()) await walk(childRel);
    }
  }
  await walk("");
  return entries;
}

async function getIndex() {
  if (!index || Date.now() - index.builtAt > INDEX_TTL_MS) {
    index = { builtAt: Date.now(), entries: await buildIndex() };
  }
  return index.entries;
}

/** Search the index: every query token as a case-insensitive substring of the
 *  name; a full-text pass greps markdown bodies for the raw phrase; an empty
 *  query returns most-recently-modified files (the quick-open default list). */
async function search(qRaw, folder, fullText, limit) {
  const all = await getIndex();
  const pool =
    folder !== undefined
      ? all.filter((e) => {
          const parent = e.relPath.slice(0, e.relPath.length - e.name.length - 1);
          return parent === folder;
        })
      : all;
  const q = (qRaw ?? "").trim().toLowerCase();
  if (!q) {
    return pool
      .filter((e) => !e.isFolder)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);
  }
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = pool.filter((e) => tokens.every((t) => e.name.toLowerCase().includes(t)));
  if (fullText && hits.length < limit) {
    const seen = new Set(hits.map((e) => e.relPath));
    for (const e of pool) {
      if (hits.length >= limit) break;
      if (e.isFolder || seen.has(e.relPath) || !/\.(md|qmd)$/i.test(e.name)) continue;
      try {
        const st = await fs.stat(path.resolve(ROOT, e.relPath));
        if (st.size > 1_000_000) continue;
        const body = await fs.readFile(path.resolve(ROOT, e.relPath), "utf8");
        if (body.toLowerCase().includes(q)) hits.push(e);
      } catch {
        // unreadable file: skip
      }
    }
  }
  return hits
    .sort((a, b) => (a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())))
    .slice(0, limit);
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks)));
    req.on("error", rej);
  });
}

const handlers = {
  "GET /stat": async (params) => statOf(params.get("path")),

  "GET /read": async (params) => {
    const rel = params.get("path");
    const abs = resolveSafe(rel);
    const buf = await fs.readFile(abs).catch(() => {
      throw new HttpError(404, `file not found: ${rel}`);
    });
    return { text: buf.toString("utf8"), version: hashOf(buf) };
  },

  "GET /raw": async (params, _req, res) => {
    const rel = params.get("path");
    const buf = await fs.readFile(resolveSafe(rel)).catch(() => {
      throw new HttpError(404, `file not found: ${rel}`);
    });
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": buf.length });
    res.end(buf);
    return null; // response already sent
  },

  "POST /write": async (params, req) => {
    const rel = params.get("path");
    const abs = resolveSafe(rel);
    const buf = await readBody(req);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    console.log(`localfs: wrote ${rel} (${buf.length} bytes)`);
    return { version: hashOf(buf) };
  },

  "GET /list": async (params) => ({ entries: await listDir(params.get("path")) }),

  "POST /mkdir": async (params) => {
    await fs.mkdir(resolveSafe(params.get("path")), { recursive: true });
    return { ok: true };
  },

  "POST /rename": async (params) => {
    const rel = params.get("path");
    const name = params.get("name");
    if (!name || name.includes("/") || name.includes("\\")) throw new HttpError(400, "bad name");
    const abs = resolveSafe(rel);
    await fs.rename(abs, path.join(path.dirname(abs), name));
    console.log(`localfs: renamed ${rel} -> ${name}`);
    return { name };
  },

  "POST /copy": async (params) => {
    const rel = params.get("path");
    const abs = resolveSafe(rel);
    const orig = path.basename(abs);
    const dot = orig.lastIndexOf(".");
    const fallback = dot > 0 ? `${orig.slice(0, dot)} (copy)${orig.slice(dot)}` : `${orig} (copy)`;
    const name = params.get("name") || fallback;
    if (name.includes("/") || name.includes("\\")) throw new HttpError(400, "bad name");
    await fs.copyFile(abs, path.join(path.dirname(abs), name));
    console.log(`localfs: copied ${rel} -> ${name}`);
    return { name };
  },

  "POST /trash": async (params) => {
    const rel = params.get("path");
    const abs = resolveSafe(rel);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
    const dest = path.join(ROOT, TRASH, `${stamp} ${path.basename(abs)}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(abs, dest);
    console.log(`localfs: trashed ${rel} -> ${TRASH}/`);
    return { ok: true };
  },

  "GET /search": async (params) => {
    const limit = Math.min(Number(params.get("limit") ?? 60) || 60, 3000);
    const folder = params.has("folder") ? params.get("folder") : undefined;
    return { files: await search(params.get("q"), folder, params.get("full") === "1", limit) };
  },

  "POST /children": async (_params, req) => {
    const { paths = [], limit = 60 } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const files = [];
    for (const rel of paths) {
      if (files.length >= limit) break;
      for (const e of await listDir(rel).catch(() => [])) {
        if (files.length >= limit) break;
        if (!e.isFolder) files.push({ relPath: rel ? `${rel}/${e.name}` : e.name, name: e.name, isFolder: false });
      }
    }
    return { files };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const handler = handlers[`${req.method} ${url.pathname}`];
  try {
    if (!handler) throw new HttpError(404, `no such endpoint: ${req.method} ${url.pathname}`);
    const body = await handler(url.searchParams, req, res);
    if (body !== null) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error("localfs:", err);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message || "internal error" }));
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  const rootStat = await fs.stat(ROOT).catch(() => null);
  if (!rootStat?.isDirectory()) {
    console.error(`localfs: LOCAL_FS_ROOT is not a folder: ${ROOT}`);
    process.exit(1);
  }
  console.log(`localfs: serving ${ROOT} on http://127.0.0.1:${PORT} (loopback only)`);
});
