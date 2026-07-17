/** Read .dev.vars (the wrangler dev secrets file) as a plain object, so the
 *  localfs sidecar and the dev:local launcher share the worker's config
 *  single-source instead of needing their own env setup. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readDevVars() {
  const vars = {};
  let text;
  try {
    text = readFileSync(resolve(repoRoot, ".dev.vars"), "utf8");
  } catch {
    return vars;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}
