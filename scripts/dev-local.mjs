/**
 * Start gmist in local-fs mode: the localfs sidecar plus a server, one command,
 * dying together. Config comes from .dev.vars (LOCAL_FS_URL, LOCAL_FS_TOKEN);
 * see .dev.vars.example.
 *
 * Two flavours, same address (5173), so nothing that opens gmist has to care:
 *
 *   npm run dev:local      the Vite dev server, for working ON gmist.
 *   npm run preview:local  a production build, for working IN gmist. Slower to
 *                          start, and the right one for TagFox to launch.
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
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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

launch("localfs sidecar", process.execPath, [resolve(repoRoot, "scripts", "localfs-server.mjs")], false);
// --built serves a production build rather than the dev server. Pinned to the
// dev server's own port, so an existing bookmark, hotkey or TagFox button
// reaches whichever flavour is running without knowing which.
const built = process.argv.includes("--built");
if (built) {
  // Its own build folder: `npm run deploy` rebuilds `build/`, which a running
  // preview holds open on Windows (EBUSY), so sharing it meant stopping local
  // gmist for every deploy.
  launch("preview server", "npm run preview -- --port 5173 --strictPort", [], true, {
    ...process.env,
    GMIST_BUILD_DIR: "build-local",
  });
} else {
  launch("dev server", "npm run dev", [], true); // shell so npm resolves on Windows too
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
