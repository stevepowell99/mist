/**
 * gmist's own slide/doc themes, replacing reveal.js's built-in themes. A deck or
 * doc picks one with a top-level `theme:` in its YAML (default `causal-map`). Each
 * theme is a plain, editable CSS file in app/styles/themes/, layered AFTER
 * deck-base.css (the composable grammar) and BEFORE any per-deck `css:`, so a
 * theme restyles the house grammar and a local file can still override it.
 *
 * The same resolved CSS is injected into the slide iframe (slides-build) and the
 * document Preview, so a file looks the same as a deck and as a doc. The shared
 * brand layer (the `.brand` logo) is prepended to every theme.
 *
 * To add a theme: drop `app/styles/themes/<name>.css` and add it to THEME_RAW.
 * Name a Google web font first in its font stack and `@import` it at the top of
 * the file, since a font installed only on Windows is missing from the PDF.
 */
import BRAND from "~/styles/themes/brand.css?raw";
import CAUSAL_MAP from "~/styles/themes/causal-map.css?raw";
import QUALIA from "~/styles/themes/qualia.css?raw";
import BRUTALIST from "~/styles/themes/brutalist.css?raw";
import EDITORIAL from "~/styles/themes/editorial.css?raw";
import BLACKBOARD from "~/styles/themes/blackboard.css?raw";
import MOONSHOT from "~/styles/themes/moonshot.css?raw";
import HANDWRITTEN from "~/styles/themes/handwritten.css?raw";
import MINIMAL from "~/styles/themes/minimal.css?raw";

export const DEFAULT_THEME = "causal-map";

const THEME_RAW: Record<string, string> = {
  "causal-map": CAUSAL_MAP,
  qualia: QUALIA,
  brutalist: BRUTALIST,
  editorial: EDITORIAL,
  blackboard: BLACKBOARD,
  moonshot: MOONSHOT,
  handwritten: HANDWRITTEN,
  minimal: MINIMAL,
};

/** Theme names a `theme:` value may select; the first is the default. */
export const THEME_NAMES = Object.keys(THEME_RAW);

/** Read the top-level `theme:` from a frontmatter string. Unknown or missing
 *  resolves to the default. Tolerates quotes and a YAML list (takes the first). */
export function resolveThemeName(frontmatter: string): string {
  const m = frontmatter.match(/^\s*theme:\s*(.+)$/m);
  if (!m) return DEFAULT_THEME;
  let v = m[1].trim().replace(/^["']|["']$/g, "");
  if (v.startsWith("[")) {
    v = v.replace(/^\[|\]$/g, "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  }
  v = v.toLowerCase();
  return THEME_NAMES.includes(v) ? v : DEFAULT_THEME;
}

/** The CSS to inject for a deck or doc: the shared brand layer plus the resolved
 *  theme. Safe to drop into a `<style>` in either the iframe or the Preview. */
export function themeCss(frontmatter: string): string {
  const theme = THEME_RAW[resolveThemeName(frontmatter)] ?? THEME_RAW[DEFAULT_THEME];
  // Each theme loads its own web font with an `@import` at the top of its file,
  // so a deck sets in the same typeface on every machine and in the server-side
  // PDF (whose Linux browser has none of the Windows fonts). CSS ignores an
  // `@import` that is not first in the sheet, so hoist it above the brand layer.
  const importRe = /^@import\b.*$/gm; // one per line; a font URL itself contains `;`
  const imports = theme.match(importRe) ?? [];
  return `${imports.join("\n")}\n${BRAND}\n${theme.replace(importRe, "")}`;
}
