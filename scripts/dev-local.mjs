/**
 * Start gmist in local-fs mode: the localfs sidecar plus the normal dev
 * server, one command (`npm run dev:local`), dying together. Config comes
 * from .dev.vars (LOCAL_FS_ROOT, LOCAL_FS_URL); see .dev.vars.example.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readDevVars, repoRoot } from "./dev-vars.mjs";

const vars = readDevVars();
if (!vars.LOCAL_FS_ROOT) {
  console.error(
    "dev:local needs LOCAL_FS_ROOT (the folder to serve) and LOCAL_FS_URL in .dev.vars;\n" +
      "see .dev.vars.example. For plain Drive-backed dev use `npm run dev`.",
  );
  process.exit(1);
}

// A sidecar left running from an earlier session holds the port, and node's
// raw EADDRINUSE stack does not say so. Check first and say what to do.
const sidecarUrl = vars.LOCAL_FS_URL || "http://127.0.0.1:5199";
const alive = await fetch(new URL("/stat?path=", sidecarUrl), { method: "GET" })
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

function launch(label, cmd, args, useShell) {
  const child = spawn(cmd, args, { cwd: repoRoot, stdio: "inherit", shell: useShell });
  child.on("exit", (code) => {
    console.error(`dev:local: ${label} exited (${code ?? "signal"})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

launch("localfs sidecar", process.execPath, [resolve(repoRoot, "scripts", "localfs-server.mjs")], false);
launch("dev server", "npm run dev", [], true); // shell so npm resolves on Windows too

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
