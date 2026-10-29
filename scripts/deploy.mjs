/**
 * `npm run deploy`: build, upload to Cloudflare, then hand the same build to
 * the local gmist (scripts/local-gmist.mjs), so the next markdown file opened
 * from TagFox is already on the new code instead of waiting for a build of its
 * own. A failed local hand-off is reported but does not fail the deploy, which
 * has already happened.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { repoRoot } from "./dev-vars.mjs";

const run = (cmd) => spawnSync(cmd, { cwd: repoRoot, stdio: "inherit", shell: true }).status ?? 1;

const startedAt = Date.now();
const built = run("npm run build");
if (built !== 0) process.exit(built);
const deployed = run("npx wrangler deploy");
if (deployed !== 0) process.exit(deployed);

const local = spawnSync(
  process.execPath,
  [resolve(repoRoot, "scripts", "local-gmist.mjs"), "refresh", "--built-at", String(startedAt)],
  { cwd: repoRoot, stdio: "inherit" },
).status;
if (local !== 0) console.error(`deploy: uploaded, but the local gmist was not refreshed (exit ${local}); see the lines above.`);
