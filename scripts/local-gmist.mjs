/**
 * Keep the local gmist (the production build that TagFox opens markdown in)
 * running, and swap new code into it without anyone waiting for a build.
 *
 *   node scripts/local-gmist.mjs serve
 *       What the GmistLocal logon task runs (scripts/install-local-gmist-task.ps1).
 *       Starts `dev-local.mjs --built` unless something already holds 5173, and
 *       waits on it, so the task shows Running for as long as gmist is up.
 *
 *   node scripts/local-gmist.mjs refresh --built-at <ms>
 *       What `npm run deploy` runs once the upload is done (scripts/deploy.mjs).
 *       Copies the build it just made into build-local and restarts the local
 *       gmist through the task, so the restart lives outside the calling shell.
 *
 *   node scripts/local-gmist.mjs refresh --build
 *       The same, building first, for a change that is not being deployed.
 *
 * Why it exists: a start that finds build-local older than any source file
 * rebuilds, which takes one to two and a half minutes on this machine, and every
 * deploy repointed `.wrangler/deploy/config.json` at `build/`, so the first open
 * from TagFox after any change waited for a full build. The deploy has already
 * built the same code, so the local gmist now takes that build instead.
 *
 * Local mode keeps no state on the server (no rooms; the file is on disk and
 * the buffer is in the tab), and a save that finds the server down retries
 * (useFileSync), so a restart costs a few seconds and loses nothing.
 *
 * Local-only: git carries this script, not the task that runs it.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "./dev-vars.mjs";

const TASK = "GmistLocal";
const PORT = 5173;
const SIDECAR_PORT = 5199;
const LOG = join(process.env.LOCALAPPDATA ?? repoRoot, "TagFox", "gmist-local.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function powershell(command) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

/** The processes listening on gmist's two ports, with their command lines and parents.
 *  The trailing `exit 0` matters: Windows PowerShell exits 1 when
 *  Get-NetTCPConnection matches nothing, SilentlyContinue or not. */
function listeners() {
  const out = powershell(
    `Get-NetTCPConnection -LocalPort ${PORT},${SIDECAR_PORT} -State Listen -ErrorAction SilentlyContinue |` +
      ` Select-Object -Unique LocalPort, OwningProcess | ForEach-Object {` +
      ` $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)";` +
      ` [pscustomobject]@{ port = $_.LocalPort; pid = $_.OwningProcess; parent = $p.ParentProcessId; cmd = $p.CommandLine } } |` +
      ` ConvertTo-Json -Compress; exit 0`,
  );
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Every process's parent and command line, for walking a tree in one query. */
function processTable() {
  const out = powershell(
    "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress",
  );
  return new Map(JSON.parse(out).map((p) => [p.ProcessId, { parent: p.ParentProcessId, cmd: p.CommandLine ?? "" }]));
}

function taskState() {
  const r = spawnSync("schtasks", ["/Query", "/TN", TASK, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null; // not registered
  return r.stdout.includes('"Running"') ? "running" : "ready";
}

async function until(test, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(500);
  }
  console.error(`local-gmist: gave up waiting for ${label} after ${ms / 1000}s`);
  return false;
}

async function answers() {
  try {
    const res = await fetch(`http://localhost:${PORT}/go`, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stop the running local gmist: the dev-local.mjs process and everything under it. */
async function stopLocal(held) {
  const procs = processTable();
  const roots = new Set();
  for (const l of held) {
    // Walk up from the listener to the dev-local.mjs that launched it, so the
    // whole tree goes (vite preview, workerd, the sidecar) and nothing else.
    let pid = l.pid;
    for (let hop = 0; hop < 4 && procs.has(pid) && !/dev-local\.mjs/.test(procs.get(pid).cmd); hop++) {
      pid = procs.get(pid).parent;
    }
    roots.add(procs.has(pid) && /dev-local\.mjs/.test(procs.get(pid).cmd) ? pid : l.pid);
  }
  for (const pid of roots) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  return until(() => listeners().length === 0, 15000, "ports 5173 and 5199 to close");
}

/** Replace build-local with `from`, stamped with the time its build started. */
async function install(from, builtAt) {
  const target = resolve(repoRoot, "build-local");
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true });
      break;
    } catch (err) {
      // Windows releases a dead process's file handles a beat after it exits.
      if (attempt >= 10) throw err;
      await sleep(500);
    }
  }
  cpSync(resolve(repoRoot, from), target, { recursive: true });
  // dev-local.mjs serves build-local without rebuilding while this stamp is newer
  // than every source file. The time the build STARTED, not now: a file saved
  // while the build ran is not in it, and must still read as newer.
  const stamp = join(target, ".built");
  writeFileSync(stamp, new Date(builtAt).toISOString());
  utimesSync(stamp, builtAt / 1000, builtAt / 1000);
  const redirect = resolve(repoRoot, ".wrangler", "deploy");
  mkdirSync(redirect, { recursive: true });
  writeFileSync(
    join(redirect, "config.json"),
    JSON.stringify({ configPath: "..\\..\\build-local\\server\\wrangler.json", auxiliaryWorkers: [] }),
  );
}

async function refresh(argv) {
  let builtAt = Number(argv[argv.indexOf("--built-at") + 1]);
  if (argv.includes("--build")) {
    builtAt = Date.now();
    const b = spawnSync("npm run build", { cwd: repoRoot, stdio: "inherit", shell: true });
    if (b.status !== 0) return b.status ?? 1;
  }
  if (!argv.includes("--build") && !(builtAt > 0)) {
    console.error("local-gmist refresh: pass --built-at <ms> (the time the build in build/ started) or --build");
    return 2;
  }
  if (!existsSync(resolve(repoRoot, "build", "server", "wrangler.json"))) {
    console.error("local-gmist refresh: build/ holds no build");
    return 1;
  }

  const held = listeners();
  const front = held.find((l) => l.port === PORT);
  if (front && !/vite\.js"?\s+preview/.test(front.cmd ?? "")) {
    // A dev server (npm run dev:local) reloads its own code; leave it alone.
    console.log("local-gmist: 5173 is a dev server, which picks up changes itself; not restarting it.");
    return 0;
  }
  const task = taskState();
  if (held.length && !task) {
    // Without the task a restart would run inside this shell and die with it.
    console.log(
      "local-gmist: local gmist is running the old code and the GmistLocal task is not installed, so it was left alone.\n" +
        "  Install the task once: pwsh -File scripts/install-local-gmist-task.ps1",
    );
    return 0;
  }

  const t0 = Date.now();
  if (held.length && !(await stopLocal(held))) return 1;
  await install("build", builtAt);
  if (!task) {
    console.log("local-gmist: build-local updated; the next start serves it without building.");
    return 0;
  }
  // The task's last run ends when its gmist does; a run requested before that is ignored.
  await until(() => taskState() !== "running", 15000, "the GmistLocal task to finish");
  spawnSync("schtasks", ["/Run", "/TN", TASK], { stdio: "ignore", windowsHide: true });
  if (!(await until(answers, 60000, "the restarted gmist to answer"))) return 1;
  console.log(`local-gmist: restarted on the new build in ${Math.round((Date.now() - t0) / 1000)}s.`);
  return 0;
}

async function serve() {
  if (listeners().some((l) => l.port === PORT)) {
    console.log("local-gmist: 5173 is already held; nothing to start.");
    return 0;
  }
  // The same log TagFox writes when it starts gmist, so a failure is in one place
  // whichever of them started it.
  mkdirSync(join(LOG, ".."), { recursive: true });
  const fd = openSync(LOG, "a");
  writeFileSync(fd, `\n--- local-gmist serve, ${new Date().toISOString()} (GmistLocal task)\n`);
  const child = spawn(process.execPath, [resolve(repoRoot, "scripts", "dev-local.mjs"), "--built"], {
    cwd: repoRoot,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  return new Promise((done) => child.on("exit", (code) => done(code ?? 1)));
}

const [cmd, ...rest] = process.argv.slice(2);
const code = cmd === "serve" ? await serve() : cmd === "refresh" ? await refresh(rest) : 2;
if (code === 2 && cmd !== "refresh") console.error("usage: node scripts/local-gmist.mjs serve | refresh --built-at <ms> | refresh --build");
process.exit(code);
