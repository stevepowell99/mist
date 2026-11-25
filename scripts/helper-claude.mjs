/**
 * The local gmist helper's model call: headless Claude Code (`claude -p`) on
 * the machine owner's own subscription, started by the localfs sidecar. The
 * worker cannot start a process (workerd), so it asks the sidecar, the same way
 * the Commit button reaches git.
 *
 * What makes it safe and cheap to run from an editor:
 *  - `--tools ""` and `--strict-mcp-config`: the model has no tools and no MCP
 *    servers, so text in a document, however it is worded, can only shape the
 *    reply. It cannot read, write or run anything.
 *  - `--setting-sources ""`, a neutral cwd and CLAUDE_HUB_DOC_SWEEP=1: none of
 *    the user's hooks, project settings or session-end jobs run per call.
 *  - ANTHROPIC_API_KEY and friends are removed from the child's environment, so
 *    it always runs on the subscription's sign-in and never on a paid key that
 *    happens to be set in the shell gmist was started from.
 *  - The prompt goes on stdin and the system prompt in a file: a multi-line
 *    argument to the Windows shim is cut at its first line break.
 *
 * GMIST_HELPER_MODEL overrides the model (default `sonnet`); GMIST_CLAUDE_BIN
 * points at the binary when it is not on PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 4 * 60 * 1000;
const PAID_ROUTES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

/**
 * The Claude Code binary. On Windows the npm install puts a `claude.cmd` shim
 * on PATH that runs a native `claude.exe` beside its package; spawning the exe
 * directly avoids cmd.exe and its quoting. Elsewhere `claude` itself.
 */
export function findClaude(env = process.env) {
  if (env.GMIST_CLAUDE_BIN) return env.GMIST_CLAUDE_BIN;
  const dirs = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? ["claude.exe", path.join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]
      : ["claude"];
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Run one helper turn. Resolves to { text, durationMs, model } or rejects with
 * an Error whose message is fit to show. `signal` aborts the run (the user
 * pressed Stop, or the request went away), killing the child.
 */
export async function askClaude({ system, prompt }, { signal } = {}) {
  const bin = findClaude();
  if (!bin) throw new Error("Claude Code was not found on this machine (set GMIST_CLAUDE_BIN to its path)");
  const model = process.env.GMIST_HELPER_MODEL || "sonnet";
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gmist-helper-"));
  const systemFile = path.join(dir, "system.md");
  await fsp.writeFile(systemFile, system, "utf8");

  const env = { ...process.env, CLAUDE_HUB_DOC_SWEEP: "1" };
  for (const k of PAID_ROUTES) delete env[k];
  const args = [
    "-p",
    "--model", model,
    "--output-format", "json",
    "--system-prompt-file", systemFile,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
  ];

  const started = Date.now();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd: os.homedir(), env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let settled = false;
      const finish = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const onAbort = () => {
        child.kill();
        finish(reject, new Error("stopped"));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(reject, new Error(`no answer after ${TIMEOUT_MS / 60000} minutes`));
      }, TIMEOUT_MS);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => finish(reject, new Error(`could not start Claude Code: ${e.message}`)));
      child.on("close", (code) => {
        let data = null;
        try {
          data = JSON.parse(out);
        } catch {
          // not JSON: reported below with whatever was printed
        }
        if (!data) {
          const why = (err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400);
          return finish(reject, new Error(`Claude Code exited ${code}${why ? `: ${why}` : ""}`));
        }
        if (data.is_error) return finish(reject, new Error(String(data.result || data.subtype || "Claude Code reported an error")));
        finish(resolve, { text: String(data.result ?? ""), durationMs: Date.now() - started, model });
      });
      child.stdin.end(prompt, "utf8");
    });
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
