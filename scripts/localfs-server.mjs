/**
 * Local-fs sidecar for gmist's local mode: a tiny HTTP server on 127.0.0.1
 * that serves this machine's files to the dev worker, which runs in workerd
 * and cannot touch the host disk itself. The worker-side client is
 * app/lib/google-localfs.server.ts. Configured by LOCAL_FS_URL and
 * LOCAL_FS_TOKEN in .dev.vars (or env). Started by `npm run dev:local` (or
 * standalone with `npm run localfs`).
 *
 * SECURITY. This process reads and writes any file the user can, so the token
 * is the whole access control, NOT the loopback bind: any page you visit can
 * POST to 127.0.0.1 (no-CORS, response unreadable but the write still lands),
 * and DNS rebinding defeats origin checks. So every request must carry the
 * shared token, which only the worker has, and requests bearing a browser
 * Origin are refused outright. There is deliberately no path allowlist: it
 * would not stop that attack (an attacker writes wherever you work), and it
 * would trap gmist under one drive letter when files live on C:, G: and H:.
 *
 * This process owns the root-less path model and ALL path arithmetic (the
 * worker holds only opaque ids), so Windows path semantics stay in one place
 * with node's `path` module. /resolve turns an absolute path into an id and is
 * how TagFox hands a file over. Local mode has no search (TagFox is the way
 * in), so nothing ever walks the tree.
 *
 * Version tokens are content hashes, so a re-save of identical bytes keeps the
 * same version and only a genuine change trips the conflict machinery. Deletes
 * are recoverable: /trash moves the file into a .gmist-trash folder beside it.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { readDevVars } from "./dev-vars.mjs";

const vars = { ...readDevVars(), ...process.env };
const TOKEN = vars.LOCAL_FS_TOKEN;
if (!TOKEN) {
  console.error(
    "localfs: LOCAL_FS_TOKEN is not set (add it to .dev.vars; any long random string).\n" +
      "It is the only thing stopping a web page you visit from writing your files.",
  );
  process.exit(1);
}
const PORT = Number(new URL(vars.LOCAL_FS_URL || "http://127.0.0.1:5199").port || 5199);
const TRASH = ".gmist-trash";

// Noise never worth showing in a folder listing (the doc sidebar, the library
// gallery); dot-directories are skipped too. Mirrors SLUDGE_DIRS in
// app/lib/google-drive.server.ts, which this script cannot import.
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

/** Constant-time token compare, so a wrong token leaks nothing by timing. */
function tokenOk(given) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Normalise an absolute path; reject a relative one (an id must be absolute). */
function absOf(p) {
  if (!p) throw new HttpError(400, "missing path");
  if (p.includes("\0")) throw new HttpError(400, "bad path");
  const abs = path.resolve(p);
  if (!path.isAbsolute(abs)) throw new HttpError(400, "path must be absolute");
  return abs;
}

const hashOf = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** The parent folder, or null at a drive/filesystem root. */
function parentOf(abs) {
  const parent = path.dirname(abs);
  return parent === abs ? null : parent;
}

/** Breadcrumb from the drive root down to `abs` inclusive. The worker cannot
 *  split Windows paths safely, so the trail is built here. */
function trailOf(abs) {
  const trail = [];
  let cur = abs;
  let guard = 0;
  while (cur && guard++ < 64) {
    trail.unshift({ path: cur, name: path.basename(cur) || cur });
    cur = parentOf(cur);
  }
  return trail;
}

async function statOf(abs) {
  try {
    const st = await fs.stat(abs);
    return {
      exists: true,
      isFolder: st.isDirectory(),
      name: path.basename(abs) || abs,
      parent: parentOf(abs),
      trail: trailOf(abs),
      mtimeMs: st.mtimeMs,
      size: st.size,
      version: st.isDirectory() ? null : hashOf(await fs.readFile(abs)),
    };
  } catch {
    return { exists: false, isFolder: false, name: path.basename(abs) || abs, parent: parentOf(abs), trail: [], mtimeMs: 0, size: 0, version: null };
  }
}

function skippable(name) {
  return name.startsWith(".") || SLUDGE.has(name) || /_files$/.test(name) || name === "desktop.ini";
}

/** Direct children of a folder, folders first then by name, noise dropped. */
async function listDir(abs) {
  const dirents = await fs.readdir(abs, { withFileTypes: true }).catch(() => {
    throw new HttpError(404, `folder not found: ${abs}`);
  });
  return dirents
    .filter((d) => (d.isDirectory() || d.isFile()) && !skippable(d.name))
    .map((d) => ({ path: path.join(abs, d.name), name: d.name, isFolder: d.isDirectory() }))
    .sort((a, b) => (a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
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
  "GET /health": async () => ({ ok: true }),

  /** Absolute path -> the file's identity, for an external tool (TagFox)
   *  handing a file over. Refuses anything that is not a real markdown file,
   *  so a bad deep link fails here rather than half-opening a room. */
  "GET /resolve": async (params) => {
    const abs = absOf(params.get("abs"));
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new HttpError(404, `no such file: ${abs}`);
    if (st.isDirectory()) throw new HttpError(400, "that is a folder, not a file");
    if (!/\.(md|qmd)$/i.test(abs)) throw new HttpError(400, "only .md or .qmd files can be opened");
    return { path: abs, name: path.basename(abs), parent: parentOf(abs) };
  },

  /** Resolve a document-relative reference (a deck's `css:`/image path, which
   *  may climb with `..`) against a base folder. Path arithmetic lives here. */
  "GET /resolve-rel": async (params) => {
    const base = absOf(params.get("base"));
    const rel = params.get("rel");
    if (rel == null) throw new HttpError(400, "missing rel");
    const abs = path.resolve(base, rel);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new HttpError(404, `not found: ${rel}`);
    return { path: abs };
  },

  "GET /stat": async (params) => statOf(absOf(params.get("path"))),

  "GET /read": async (params) => {
    const abs = absOf(params.get("path"));
    const buf = await fs.readFile(abs).catch(() => {
      throw new HttpError(404, `file not found: ${abs}`);
    });
    return { text: buf.toString("utf8"), version: hashOf(buf) };
  },

  "GET /raw": async (params, _req, res) => {
    const abs = absOf(params.get("path"));
    const buf = await fs.readFile(abs).catch(() => {
      throw new HttpError(404, `file not found: ${abs}`);
    });
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": buf.length });
    res.end(buf);
    return null; // response already sent
  },

  "POST /write": async (params, req) => {
    const abs = absOf(params.get("path"));
    const buf = await readBody(req);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    console.log(`localfs: wrote ${abs} (${buf.length} bytes)`);
    return { version: hashOf(buf) };
  },

  "GET /list": async (params) => ({ entries: await listDir(absOf(params.get("path"))) }),

  "POST /mkdir": async (params) => {
    await fs.mkdir(absOf(params.get("path")), { recursive: true });
    return { ok: true };
  },

  "POST /rename": async (params) => {
    const abs = absOf(params.get("path"));
    const name = params.get("name");
    if (!name || name.includes("/") || name.includes("\\")) throw new HttpError(400, "bad name");
    const dest = path.join(path.dirname(abs), name);
    await fs.rename(abs, dest);
    console.log(`localfs: renamed ${abs} -> ${name}`);
    return { path: dest, name };
  },

  "POST /copy": async (params) => {
    const abs = absOf(params.get("path"));
    const orig = path.basename(abs);
    const ext = path.extname(orig);
    const fallback = ext ? `${orig.slice(0, -ext.length)} (copy)${ext}` : `${orig} (copy)`;
    const name = params.get("name") || fallback;
    if (name.includes("/") || name.includes("\\")) throw new HttpError(400, "bad name");
    const dest = path.join(path.dirname(abs), name);
    await fs.copyFile(abs, dest);
    console.log(`localfs: copied ${abs} -> ${name}`);
    return { path: dest, name };
  },

  /** Recoverable delete: into a .gmist-trash beside the file, never unlink. */
  "POST /trash": async (params) => {
    const abs = absOf(params.get("path"));
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
    const dest = path.join(path.dirname(abs), TRASH, `${stamp} ${path.basename(abs)}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(abs, dest);
    console.log(`localfs: trashed ${abs} -> ${TRASH}/`);
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    // A browser always sends Origin on a cross-origin request; the worker's
    // own subrequests never do. Refuse those outright, before the token, so a
    // hostile page cannot even probe.
    if (req.headers.origin) throw new HttpError(403, "cross-origin requests are not accepted");
    if (!tokenOk(req.headers["x-localfs-token"])) throw new HttpError(401, "bad or missing token");

    const handler = handlers[`${req.method} ${url.pathname}`];
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`localfs: serving this machine's files on http://127.0.0.1:${PORT} (loopback, token required)`);
});
