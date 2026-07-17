/**
 * Start gmist in local-fs mode: the localfs sidecar plus the normal dev
 * server, one command (`npm run dev:local`), dying together. Config comes
 * from .dev.vars (LOCAL_FS_URL, LOCAL_FS_TOKEN); see .dev.vars.example.
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
