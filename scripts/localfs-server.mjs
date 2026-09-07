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
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { readDevVars } from "./dev-vars.mjs";

/**
 * Commit one file, from the editor, on demand.
 *
 * A commit is the only thing that survives every way work gets destroyed here:
 * an agent running `git checkout -- <file>` to tidy a working tree it assumes is
 * its own debris, a session rewind restoring a stale checkpoint, a whole-file
 * write from a copy read hours ago. None of them can touch an object already in
 * git. Snapshots make a loss recoverable; this makes it not a loss.
 *
 * Only ever the one path, never `git add -A`: the repo may have another agent's
 * work staged in it, and sweeping that into Steve's documentation commit would
 * be its own small disaster. `git commit -- <path>` commits that path alone and
 * leaves the index untouched.
 *
 * execFile with an argument array, never a shell: the path comes in over HTTP.
 */
function git(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || "").trim(), err: (stderr || "").trim() });
    });
  });
}

/**
 * One record of everything that happens to a file gmist has open.
 *
 * There were three stores by the end of 7 September 2026: a log of gmist's own
 * writes, a tree of snapshots, and a dump of running processes. Answering "what
 * happened to this file" meant correlating them by hand, in two different
 * timezones, and the process dump never named anything because it was built to
 * catch a short-lived writer when the writer was a session that had been alive
 * for hours. So: one log, one shape, every observed change, and each line names
 * the snapshot holding the content it produced.
 *
 * This process is the only thing that touches the disk, so it is the only place
 * that knows what was actually there when a write arrived. Without that record
 * an overwrite can only be reconstructed afterwards from commit sizes and
 * guesswork, which on 2 September 2026 produced two confident and wrong
 * attributions in a row. stdout is not enough: it goes to whichever terminal
 * started the server and is lost on the next restart.
 *
 * One JSON object per line, appended, never rotated by us: the file is small
 * (a line per save) and losing history is the whole thing it exists to prevent.
 */

/**
 * Keep every version of a file gmist has open, whoever writes it.
 *
 * The write log says who wrote and what changed, which is diagnosis. This is the
 * repair: an agent, a script or a stray tool overwrites the file and the version
 * before it is already on disk, named and timestamped, so getting the work back
 * is a copy rather than an investigation. Three times in a week Steve lost
 * editing to a write nothing could be pinned on afterwards; twice the content
 * was simply gone.
 *
 * Every file served through here is polled, so a change made by something that
 * never touches this process is caught too. That is the whole point: the writes
 * worth surviving are the ones we do not make.
 */
/**
 * Who wrote the file.
 *
 * Three layers of logging so far have recorded the effect precisely and named
 * nobody: the write log says gmist did not do it, the snapshots say exactly what
 * changed and when, and neither says which process. So this samples the running
 * processes continuously and keeps the last fifteen seconds, and when a file
 * changes underneath us it writes out that window. A `git.exe` or a shell that
 * lived for half a second before the file moved is then on the record, named,
 * with its command line, instead of being reconstructed afterwards from commit
 * sizes.
 *
 * `tasklist` rather than anything cleverer because it needs no privilege. The
 * certain answer is Windows object-access auditing, which records the writing
 * process for every write, and which needs one elevation to switch on; see
 * docs/who-writes-this-file.md.
 */
const SNAP_DIR = path.join(process.cwd(), "logs", "snapshots");
const SNAP_KEEP = 50;
const SNAP_POLL_MS = 700;
const SNAP_MAX_BYTES = 4 * 1024 * 1024;
/** Served path -> the hash of the last version snapshotted for it. */
const watched = new Map();

function snapDirFor(abs) {
  // One folder per file, named so two files called the same thing stay apart.
  const safe = abs.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(-120);
  return path.join(SNAP_DIR, safe);
}

function snapshot(abs, buf) {
  if (!buf || buf.length === 0 || buf.length > SNAP_MAX_BYTES) return;
  const version = hashOf(buf);
  if (watched.get(abs) === version) return version;
  watched.set(abs, version);
  try {
    const dir = snapDirFor(abs);
    fsSync.mkdirSync(dir, { recursive: true });
    const stamp = localStamp().replace(/[:.+]/g, "-");
    fsSync.writeFileSync(path.join(dir, `${stamp}__${version}${path.extname(abs)}`), buf);
    const kept = fsSync.readdirSync(dir).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - SNAP_KEEP))) {
      try { fsSync.unlinkSync(path.join(dir, old)); } catch { /* already gone */ }
    }
  } catch {
    // snapshotting must never be the reason a read or a save fails
  }
}

// Catch a change made by anything else. A file is polled from the moment gmist
// first reads it and until this process ends, which is what makes an outside
// clobber recoverable rather than merely detectable.
setInterval(() => {
  for (const abs of [...watched.keys()]) {
    const before = watched.get(abs);
    fsSync.readFile(abs, (err, buf) => {
      if (err) return;
      const now = hashOf(buf);
      if (now !== before && before !== undefined) {
        // Nobody claimed this one: gmist's own writes are logged as they happen,
        // so a change seen only by the poll came from something else.
        record({ op: "changed-by-something-else", path: abs, bytes: buf.length, was: null, expected: before, onDisk: now, client: null });
      }
      snapshot(abs, buf);
    });
  }
}, SNAP_POLL_MS).unref();

const LOG_PATH = path.join(process.cwd(), "logs", "file-history.log");
/** Local time with its offset. The first version of this log wrote UTC, which
 *  then had to be compared against file times in local time; reading the two an
 *  hour apart is the same mistake that made the first incident note wrong. */
function localStamp() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 23) +
    sign + pad(off / 60) + ":" + pad(off % 60);
}

function record(entry) {
  try {
    fsSync.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fsSync.appendFileSync(LOG_PATH, JSON.stringify({ at: localStamp(), ...entry }) + "\n");
  } catch {
    // logging must never be the reason a save fails
  }
}

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
    // First sight of this file: keep this version, and start watching it.
    snapshot(abs, buf);
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
    // Conditional write. `expected` is the version the caller last saw, and the
    // check happens HERE, next to the write, because this process is the only
    // one that touches the disk. Doing it in the worker meant a stat, a network
    // hop and then a write, with a window in between in which the file could
    // change; a stale room could win that race and its own older copy of the
    // file would land with nothing said. A caller with no baseline (a new file,
    // a deliberate overwrite) simply omits it.
    const expected = params.get("expected");
    const client = req.headers["x-gmist-client"] || null;
    let current = null;
    let existing = null;
    try {
      existing = await fs.readFile(abs);
      current = hashOf(existing);
    } catch {
      current = null; // no file yet, or gone since the caller read it
    }
    if (expected && current !== null && current !== expected) {
      record({ op: "refused", path: abs, bytes: buf.length, was: existing.length, expected, onDisk: current, client });
      throw new HttpError(409, "file changed upstream; reload and retry");
    }
    // Keep what we are about to replace, then what we wrote. The first covers a
    // change somebody else made between our polls; the second is the version most
    // worth having back, since it is the one the editor believed was saved.
    if (existing) snapshot(abs, existing);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    snapshot(abs, buf);
    const version = hashOf(buf);
    // `was` next to `bytes` is the pair worth having: a save that shrinks a file
    // by twenty thousand characters is the shape of a stale buffer landing, and
    // it is invisible in a byte count on its own.
    record({ op: "wrote", path: abs, bytes: buf.length, was: existing ? existing.length : 0, expected: expected ?? null, onDisk: current, version, client });
    console.log(`localfs: wrote ${abs} (${buf.length} bytes, was ${existing ? existing.length : 0})`);
    return { version };
  },

  // Whether this file sits in a git work tree, and whether it differs from what
  // is committed. The editor asks so it can offer a commit only where one means
  // something, and say whether there is anything to commit.
  "GET /git-info": async (params) => {
    const abs = absOf(params.get("path"));
    const cwd = path.dirname(abs);
    const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    if (!inside.ok || inside.out !== "true") return { repo: false, dirty: false, branch: null };
    const [status, branch] = await Promise.all([
      git(["status", "--porcelain", "--", abs], cwd),
      git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    ]);
    return { repo: true, dirty: status.ok && status.out !== "", branch: branch.ok ? branch.out : null };
  },

  "POST /git-commit": async (params, req) => {
    const abs = absOf(params.get("path"));
    const cwd = path.dirname(abs);
    const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    if (!inside.ok || inside.out !== "true") throw new HttpError(400, "not inside a git work tree");

    const body = (await readBody(req)).toString("utf8");
    let message = "";
    try {
      message = String(JSON.parse(body || "{}").message || "");
    } catch {
      message = "";
    }
    message = message.trim() || `docs: edit ${path.basename(abs)} in gmist`;

    const status = await git(["status", "--porcelain", "--", abs], cwd);
    if (status.ok && status.out === "") return { committed: false, reason: "nothing to commit" };

    // A file git has never seen has to be added before it can be named in a
    // commit: `git commit -- <path>` matches tracked paths only, and answers an
    // untracked one with "did not match any file(s) known to git". Adding this
    // one path is still not `git add -A`, so anything else staged in the repo is
    // left exactly as it was.
    if (status.ok && status.out.startsWith("??")) {
      const added = await git(["add", "--", abs], cwd);
      if (!added.ok) throw new HttpError(500, added.err || "could not add the file");
    }

    const done = await git(["commit", "-m", message, "--", abs], cwd);
    if (!done.ok) {
      record({ op: "commit-failed", path: abs, bytes: 0, was: 0, expected: null, onDisk: null, client: done.err.slice(0, 200) });
      throw new HttpError(500, done.err || done.out || "commit failed");
    }
    const hash = await git(["rev-parse", "--short", "HEAD"], cwd);
    record({ op: "committed", path: abs, bytes: 0, was: 0, expected: null, onDisk: hash.out, client: message.slice(0, 200) });
    console.log(`localfs: committed ${abs} as ${hash.out}`);
    return { committed: true, hash: hash.out, message };
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
