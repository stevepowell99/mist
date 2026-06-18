// Generate the stepped numeric utilities (scale, opacity, width, height, and the
// place coordinates) into deck-base.css from the single manifest
// app/styles/classes.json, so the picker (which reads the manifest) and the CSS
// never drift. Only the arithmetic axes are generated; appearance (components,
// colour, fill, border, theme, shade, align) stays hand-written in the CSS and is
// guarded there by the classes-css-sync test.
//
//   node scripts/gen-styles.mjs           rewrite the GENERATED region in place
//   node scripts/gen-styles.mjs --check   exit non-zero if the region is stale
//
// ESM, no deps; needs Node 20+.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const CSS_PATH = fileURLToPath(new URL("app/styles/deck-base.css", ROOT));
const MANIFEST_PATH = fileURLToPath(new URL("app/styles/classes.json", ROOT));

export const BEGIN = "/* GENERATED stepped utilities (scripts/gen-styles.mjs); do not edit by hand */";
export const END = "/* END GENERATED */";

const SCOPE_SEL = { core: ":is(.reveal,.preview) ", deck: ".reveal " };

/** A numeric value formatted for its unit: `%` -> `n%`, `px` -> `npx`,
 *  `ratio` -> n/100 (e.g. 150 -> 1.5). */
function fmtVal(n, unit) {
  if (unit === "px") return `${n}px`;
  if (unit === "ratio") return `${n / 100}`;
  return `${n}%`; // "%" and the default
}

/** The step list of a generated block: an explicit `values` array, or `from`/`to`
 *  by `step`. */
function stepsOf(g) {
  if (Array.isArray(g.values)) return g.values;
  const out = [];
  for (let v = g.from ?? 0; v <= (g.to ?? 0); v += g.step) out.push(v);
  return out;
}

/** Build the GENERATED region (markers included) from the parsed manifest. Pure,
 *  so the check test can compare its output to the file. */
export function generate(manifest) {
  const lines = [BEGIN];
  for (const [name, axis] of Object.entries(manifest.axes ?? {})) {
    const g = axis.generated;
    // Only scope-tagged numeric axes are generated; the colour-suffixed families
    // (fill/border) and fade carry appearance and stay hand-written.
    if (!g || !g.scope) continue;
    const sel = SCOPE_SEL[g.scope];
    const prefixes = Array.isArray(g.prefix) ? g.prefix : [g.prefix];
    const steps = stepsOf(g);
    for (const prefix of prefixes) {
      // property "self" (or absent) means the declared property IS the prefix,
      // e.g. top -> `top:`, width -> `width:`.
      const prop = g.property && g.property !== "self" ? g.property : prefix;
      const rules = steps
        .map((n) => {
          let decl = `${prop}:${fmtVal(n, g.unit)}`;
          if (g.alsoVar) decl += `;${g.alsoVar}:${fmtVal(n, g.unit)}`;
          return `${sel}.${prefix}-${n}{${decl}}`;
        })
        .join("");
      const label = prefixes.length > 1 ? `${name} (${prefix})` : name;
      lines.push(`/* ${label} */ ${rules}`);
    }
  }
  lines.push(END);
  return lines.join("\n");
}

function regionRe() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`);
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const region = generate(manifest);
  const css = readFileSync(CSS_PATH, "utf8");
  const re = regionRe();
  const current = css.match(re);
  if (!current) {
    console.error(`gen-styles: marker region not found in ${CSS_PATH}`);
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    if (current[0] !== region) {
      console.error("gen-styles: deck-base.css GENERATED region is stale; run `npm run gen:styles`.");
      process.exit(1);
    }
    return;
  }
  const next = css.replace(re, region);
  if (next !== css) {
    writeFileSync(CSS_PATH, next);
    console.log("gen-styles: rewrote the GENERATED region in deck-base.css.");
  } else {
    console.log("gen-styles: GENERATED region already up to date.");
  }
}

// Run only when invoked directly (not when the test imports `generate`).
function invokedDirectly() {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) main();
