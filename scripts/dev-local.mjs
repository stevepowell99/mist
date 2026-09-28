/**
 * Start gmist in local-fs mode: the localfs sidecar plus a server, one command,
 * dying together. Config comes from .dev.vars (LOCAL_FS_URL, LOCAL_FS_TOKEN);
 * see .dev.vars.example.
 *
 * Two flavours, same address (5173), so nothing that opens gmist has to care:
 *
 *   npm run dev:local      the Vite dev server, for working ON gmist.
 *   npm run preview:local  a production build, for working IN gmist, and the
 *                          right one for TagFox to launch. It builds only when
 *                          a source file is newer than the last build; a start
 *                          with nothing changed takes seconds, not minutes.
 *
 * The difference is not just speed. React's dev build logs every commit, and
 * that logging deep-walks component props: React Router hangs the real `window`
 * off its router object, and `window[0]` is the deck's sandboxed iframe, which
 * is cross-origin, so reading it throws SecurityError inside a passive effect
 * and takes React's work loop down ("Should not already be working"). The page
 * then looks fine and is completely dead: every button silently does nothing,
 * while links still work because they need no handler. Any deck with the slide
 * pane open does it, every time. None of that code exists in a production
 * build, which is why this flavour is here.
 */
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { readDevVars, repoRoot } from "./dev-vars.mjs";

let vars = readDevVars();

// The sidecar's token is its whole access control, but it is not something to
// make the user manage: generate one into .dev.vars the first time and never
// ask again. Both the sidecar and the worker read it from .dev.vars, so it must
// live there (the worker does not see process.env), which is why this writes the
// file rather than passing an ephemeral value. .dev.vars is gitignored.
if (!vars.LOCAL_FS_TOKEN) {
  const devVarsPath = resolve(repoRoot, ".dev.vars");
  let existing = "";
  try {
    existing = readFileSync(devVarsPath, "utf8");
  } catch {
    /* no .dev.vars yet; appendFileSync creates it */
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(devVarsPath, `${prefix}LOCAL_FS_TOKEN=${randomUUID()}${randomUUID()}\n`);
  console.log("dev:local: generated a LOCAL_FS_TOKEN in .dev.vars (one-time).");
  vars = readDevVars();
}

// A sidecar left running from an earlier session holds the port, and node's
// raw EADDRINUSE stack does not say so. Check first and say what to do.
const sidecarUrl = vars.LOCAL_FS_URL || "http://127.0.0.1:5199";
const alive = await fetch(new URL("/health", sidecarUrl), {
  headers: { "X-Localfs-Token": vars.LOCAL_FS_TOKEN },
})
  .then((r) => r.ok)
  .catch(() => false);
if (alive) {
  console.error(
    `dev:local: a localfs sidecar is already listening on ${sidecarUrl}.\n` +
      "Stop it (or close the other dev:local window) and retry; `npm run dev` alone\n" +
      "will not start one.",
  );
  process.exit(1);
}

const children = [];
let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  process.exitCode = code;
}

function launch(label, cmd, args, useShell, env = process.env) {
  const child = spawn(cmd, args, { cwd: repoRoot, stdio: "inherit", shell: useShell, env });
  child.on("exit", (code) => {
    console.error(`dev:local: ${label} exited (${code ?? "signal"})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

// True when the last local build finished after every file that feeds it was
// last written, and `.wrangler/deploy/config.json` still points at it (`npm run
// deploy` repoints that at `build/`, and a preview would then serve the wrong
// folder). Anything missing or unreadable reads as stale: the cost of a wrong
// "stale" is a rebuild, the cost of a wrong "current" is old code in the editor.
function buildIsCurrent(stamp) {
  const newest = (path) => {
    let s;
    try {
      s = statSync(path);
    } catch {
      return 0;
    }
    if (!s.isDirectory()) return s.mtimeMs;
    let latest = 0;
    for (const e of readdirSync(path, { withFileTypes: true })) {
      latest = Math.max(latest, newest(join(path, e.name)));
    }
    return latest;
  };
  try {
    const builtAt = statSync(stamp).mtimeMs;
    const redirect = readFileSync(resolve(repoRoot, ".wrangler", "deploy", "config.json"), "utf8");
    if (!redirect.includes("build-local")) return false;
    const inputs = [
      "agents", "app", "workers", "public",
      "package.json", "package-lock.json", "vite.config.ts", "react-router.config.ts",
      "wrangler.jsonc", "tsconfig.json", "tsconfig.cloudflare.json", "tsconfig.node.json",
    ];
    return inputs.every((p) => newest(resolve(repoRoot, p)) <= builtAt);
  } catch {
    return false;
  }
}

launch("localfs sidecar", process.execPath, [resolve(repoRoot, "scripts", "localfs-server.mjs")], false);
// --built serves a production build rather than the dev server. Pinned to the
// dev server's own port, so an existing bookmark, hotkey or TagFox button
// reaches whichever flavour is running without knowing which.
const built = process.argv.includes("--built");
if (built) {
  // Its own build folder: `npm run deploy` rebuilds `build/`, which a running
  // preview holds open on Windows (EBUSY), so sharing it meant stopping local
  // gmist for every deploy.
  const env = { ...process.env, GMIST_BUILD_DIR: "build-local" };
  const stamp = resolve(repoRoot, "build-local", ".built");
  if (buildIsCurrent(stamp)) {
    console.log("dev:local: build-local is newer than every source file; not rebuilding.");
  } else {
    // A build takes 40 seconds on a quiet machine and over 3 minutes on a busy
    // one, and TagFox gives up on the port after 5, so rebuilding on every start
    // meant a text editor that sometimes did not open at all.
    const code = await new Promise((done) => {
      const build = spawn("npm run build", [], { cwd: repoRoot, stdio: "inherit", shell: true, env });
      children.push(build);
      build.on("exit", (c) => done(c ?? 1));
    });
    if (code !== 0) {
      console.error(`dev:local: build failed (${code})`);
      shutdown(code);
      process.exit(code);
    }
    writeFileSync(stamp, new Date().toISOString());
  }
  // The vite binary directly: `npm run preview` would build again first.
  const viteBin = resolve(repoRoot, "node_modules", "vite", "bin", "vite.js");
  launch("preview server", process.execPath, [viteBin, "preview", "--port", "5173", "--strictPort"], false, env);
} else {
  launch("dev server", "npm run dev", [], true); // shell so npm resolves on Windows too
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
