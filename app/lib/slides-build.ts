/**
 * Pure builder that turns deck markdown (Quarto/RevealJS syntax) into a complete
 * reveal.js HTML document. Shared by the inline SlidesView (iframe srcDoc) and
 * the server-rendered print route, so both produce identical decks. No React or
 * browser globals, so it runs on the worker too.
 */
import { driveAssetUrl, resolveAssetSrc, rewriteImages, type AssetCtx } from "~/lib/asset-urls";
import { convertCitations, formatReferenceList, type BibLibrary } from "~/lib/citations";
import type { DriveMeta } from "~/shared/types";
// The house framework, served as the default stylesheet for every deck BEFORE
// any per-deck `css:`, so a deck anywhere renders correctly and a local file can
// override it via the cascade. Edited as a plain CSS file, not a TS string.
import DECK_BASE_CSS from "~/styles/deck-base.css?raw";
// gmist's own themes (replacing reveal.js themes): the resolved theme CSS is
// injected after deck-base and before any per-deck `css:`. See app/lib/themes.ts.
import { themeCss } from "~/lib/themes";

export function stripFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { frontmatter: m[1], body: md.slice(m[0].length) } : { frontmatter: "", body: md };
}

/**
 * True when the document should render as slides. A deck is identified by its
 * frontmatter declaring the reveal.js format (format: revealjs), exactly as
 * Quarto does, independent of the file extension. So a `.md` deck is detected
 * and a `.qmd` that is a document or report is not misread as slides.
 */
export function isSlideDeck(markdown: string, frontmatter = ""): boolean {
  const fm = frontmatter || stripFrontmatter(markdown).frontmatter;
  return /revealjs/i.test(fm);
}

function stripCritic(md: string): string {
  return md
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, "$1")
    .replace(/\{--[\s\S]*?--\}/g, "")
    .replace(/\{==([\s\S]*?)==\}/g, "$1")
    .replace(/\{>>[\s\S]*?<<\}/g, "");
}

/** Split into slides at level-1/2 headings and standalone `---` rules, Quarto-style. */
function splitSlides(body: string): string[] {
  const lines = body.split("\n");
  const slides: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.some((l) => l.trim() !== "")) slides.push(cur.join("\n"));
    cur = [];
  };
  for (const line of lines) {
    if (line.trim() === "---") {
      flush();
      continue;
    }
    if (/^#{1,2}\s/.test(line) && cur.some((l) => l.trim() !== "")) {
      flush();
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  flush();
  return slides.length ? slides : [body];
}

/** The heading level of a slide (1 for `#`, 2 for `##`, 0 for none), skipping
 *  any leading blank lines left by the frontmatter split. */
function headingLevel(slideMd: string): number {
  const lines = slideMd.split("\n");
  let h = 0;
  while (h < lines.length && lines[h].trim() === "") h++;
  const m = (lines[h] ?? "").match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

/**
 * Group the flat slide list into reveal vertical stacks, Quarto-style
 * (slide-level 2): a level-1 `#` starts a section that following deeper slides
 * nest under, so reveal renders a 2D grid (sections across, sub-slides down).
 * Slides before the first `#` stay top-level (horizontal). Order is preserved,
 * so a flat index still maps straight onto reveal's slide order.
 */
function groupSlides(flat: string[]): string[][] {
  const groups: string[][] = [];
  let stack: string[] | null = null;
  for (const s of flat) {
    if (headingLevel(s) === 1) {
      stack = [s];
      groups.push(stack);
    } else if (stack) {
      stack.push(s);
    } else {
      groups.push([s]);
    }
  }
  return groups;
}

function classesFrom(attr: string): string[] {
  // Drop quoted values first so a path like "../img/a.png" inside
  // background-image="..." does not yield a bogus ".png" class.
  const noQuotes = attr.replace(/=\s*"[^"]*"/g, "");
  return [...noQuotes.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

/** A leading `# Heading {.cls background-color="..."}` becomes section attributes. */
function parseHeading(line: string, ctx: AssetCtx): { heading: string; classAttr: string; bgAttr: string } {
  const m = line.match(/^(#{1,6})\s*(.*?)\s*\{([^}]*)\}\s*$/);
  if (!m) return { heading: line, classAttr: "", bgAttr: "" };
  const [, hashes, text, attr] = m;
  const classes = classesFrom(attr);
  const bg: string[] = [];
  for (const key of ["background-color", "background-image", "background-size", "background-position"]) {
    const v = attr.match(new RegExp(`${key}="([^"]+)"`));
    if (!v) continue;
    let val = v[1];
    if (key === "background-image") val = resolveAssetSrc(val, ctx);
    bg.push(`data-${key}="${val}"`);
  }
  const heading = text ? `${hashes} ${text}` : ""; // drop empty (e.g. .no-title) headings
  return { heading, classAttr: classes.length ? ` class="${classes.join(" ")}"` : "", bgAttr: bg.join(" ") };
}

/** Parse a Pandoc attribute spec: .classes, #id, and key="value" pairs. */
function parseAttrs(attr: string): { classes: string[]; id: string | null; style: string } {
  const classes = [...attr.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const idM = attr.match(/#([\w-]+)/);
  const styles: string[] = [];
  const styleM = attr.match(/\bstyle="([^"]*)"/);
  if (styleM) styles.push(styleM[1].replace(/;\s*$/, ""));
  const wM = attr.match(/\bwidth="?([\d.]+(?:%|px|em|rem|vw)?)"?/);
  if (wM && !/\bwidth\s*:/.test(styles.join(";"))) styles.push(`width:${wM[1]}`);
  const hM = attr.match(/\bheight="?([\d.]+(?:%|px|em|rem|vh)?)"?/);
  if (hM && !/\bheight\s*:/.test(styles.join(";"))) styles.push(`height:${hM[1]}`);
  return { classes, id: idM ? idM[1] : null, style: styles.join(";") };
}

function attrString(classes: string[], id: string | null, style: string): string {
  return (
    (classes.length ? ` class="${classes.join(" ")}"` : "") +
    (id ? ` id="${id}"` : "") +
    (style ? ` style="${style}"` : "")
  );
}

/** The wider Obsidian/Quartz callout vocabulary mapped onto gmist's five styled
 *  colour buckets (note=blue, tip=green, warning=yellow, danger=pink, plus the
 *  grey quote/example), so a file authored for the Garden, which accepts all
 *  these types, renders with a sensible colour here too instead of a bare grey
 *  fallback. Parity of colour, not identity: types gmist already styles
 *  (note/info/tip/success/warning/caution/important/danger/error/quote/example)
 *  are left to deck-base.css and keep their existing look. See
 *  docs/author-grammar.md for the shared grammar contract. */
const CALLOUT_ALIAS: Record<string, string> = {
  abstract: "info", summary: "info", tldr: "info", todo: "info", question: "info", help: "info", faq: "info",
  done: "tip", check: "tip", hint: "tip",
  attention: "warning",
  alert: "danger", failure: "danger", fail: "danger", missing: "danger", bug: "danger",
  cite: "note",
};

/** Obsidian/Quartz callouts: a `> [!type] Title` line plus the following `> `
 *  lines become a `::: {.callout .callout-type}` fenced div (title as a
 *  `.callout-title` span), so the shared callout component styles them in both
 *  docs and decks. Run before convertSpans/convertDivs. The `[-+]?` foldable
 *  marker is tolerated (the content stays visible; gmist has no `<details>`). */
export function convertCallouts(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*>\s*\[!([\w-]+)\][-+]?\s*(.*)$/);
    if (!m) { out.push(lines[i]); continue; }
    const raw = m[1].toLowerCase();
    const type = CALLOUT_ALIAS[raw] ?? raw;
    const title = m[2].trim();
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const bm = lines[j].match(/^\s*>\s?(.*)$/);
      if (bm === null) break;
      body.push(bm[1]);
    }
    out.push("", `::: {.callout .callout-${type}}`, "");
    if (title) out.push(`[${title}]{.callout-title}`, "");
    out.push(...body, "", ":::", "");
    i = j - 1;
  }
  return out.join("\n");
}

/** Turn Quarto `::: {...}` fenced divs into real div/aside elements. */
export function convertDivs(md: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!/^:::+/.test(t)) {
      out.push(line);
      continue;
    }
    const braced = t.match(/^:::+\s*\{([^}]*)\}\s*$/);
    const bare = t.match(/^:::+\s+(\S.*)$/);
    if (braced || bare) {
      const attr = (braced ? braced[1] : bare![1]) ?? "";
      const parsed = parseAttrs(attr);
      let classes = parsed.classes;
      if (!classes.length) classes = attr.split(/\s+/).filter((w) => /^[\w-]+$/.test(w));
      const tag = classes.includes("notes") ? "aside" : "div";
      stack.push(tag);
      out.push("", `<${tag}${attrString(classes, parsed.id, parsed.style)}>`, "");
    } else if (stack.length) {
      out.push("", `</${stack.pop()}>`, "");
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("\n");
}

/** Markdown images carrying Pandoc attributes, e.g. `![](logo.png){.brand}`. */
export function convertImages(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\{([^}]*)\}/g,
    (_w, alt: string, url: string, attr: string) => {
      const { classes, id, style } = parseAttrs(attr);
      return `<img src="${url}" alt="${alt}"${attrString(classes, id, style)}>`;
    },
  );
}

/** Inline `[text]{.flare .blue}` spans, carrying classes, id and style. */
export function convertSpans(md: string): string {
  return md.replace(/\[([^\]]+)\]\{([^}]*)\}/g, (_w, text: string, attr: string) => {
    const { classes, id, style } = parseAttrs(attr);
    if (!classes.length && !id && !style) return text;
    return `<span${attrString(classes, id, style)}>${text}</span>`;
  });
}

function buildSection(slideMd: string, ctx: AssetCtx): string {
  const lines = slideMd.split("\n");
  // Skip any leading blank lines so the first slide's heading (which follows
  // the blank line left after the frontmatter) is still recognised.
  let h = 0;
  while (h < lines.length && lines[h].trim() === "") h++;
  const headingLine = lines[h] ?? "";
  let classAttr = "";
  let bgComment = "";
  let body = slideMd;
  if (/^#{1,6}\s/.test(headingLine)) {
    // A slide marked hidden (Quarto `{visibility="hidden"}` or a `.hidden`
    // class) is omitted from the deck entirely, so hide/unhide works in the
    // preview without depending on the deck's own CSS.
    if (/\bvisibility\s*=\s*"hidden"/.test(headingLine) || /\{[^}]*\.hidden(?:-slide)?\b[^}]*\}/.test(headingLine)) {
      return "";
    }
    const parsed = parseHeading(headingLine, ctx);
    classAttr = parsed.classAttr;
    // reveal.js markdown slides take their background via a leading
    // `<!-- .slide: ... -->` comment, not a section-element attribute (the
    // markdown plugin regenerates the slide and ignores section attrs).
    if (parsed.bgAttr) bgComment = `<!-- .slide: ${parsed.bgAttr} -->\n`;
    body = [parsed.heading, ...lines.slice(h + 1)].join("\n");
  }
  const inner = convertDivs(convertImages(convertSpans(convertCallouts(body)))).replace(/<\/textarea>/gi, "&lt;/textarea&gt;");
  return `<section${classAttr} data-markdown><textarea data-template>\n${bgComment}${inner}\n</textarea></section>`;
}

const PREVIEW_CSS = `
html,body{margin:0;height:100%}
.columns{display:flex;gap:1em;align-items:flex-start}
.column{flex:1;min-width:0}
.columns .columns{width:100%}
.callout{border:1px solid #ccc;border-radius:6px;padding:.5em .75em;margin:.5em 0;text-align:left}
.callout-note{border-left:4px solid #4a90d9}
.callout-tip{border-left:4px solid #3aa76d}
.callout-warning,.callout-important{border-left:4px solid #e0a800}
.no-title h1,.no-title h2,.no-title h3{display:none}
/* Make the preview WYSIWYG with fullscreen/PDF: stretch every slide to the full
   stage height (1280x720) and clip its overflow. Reveal otherwise leaves a slide
   at its content height, so in a narrow preview (which letterboxes the 16:9
   slide) the spare space below shows content that overflows the slide height,
   making an overstuffed slide look fine here yet get cut off in fullscreen. This
   also pins a .shot-cap caption to the slide edge (it needs the full height). */
/* Excluded in overview (:not(.overview)): there reveal lays the slides out as a
   transformed grid, and forcing height/overflow on each section pulls the slide
   content out of its overview cell, so the selection outline stops lining up. */
.reveal:not(.overview) .slides section:not(.stack){height:100%;overflow:hidden}
/* In the embedded preview, tint the letterbox (the area above/below or beside
   the 16:9 slide) light grey so it is clear where the slide ends, while keeping
   the slide itself white. Only the default (transparent) slide background gets
   white; a slide with its own colour/image background keeps it (reveal sets that
   inline). Scoped to .mist-embedded so the print/PDF page stays plain white. */
html.mist-embedded{background:#ececec !important}
/* The slide canvas reads --slide-bg (set by the theme, default white), so a
   theme's background shows in the embedded preview AND in fullscreen/PDF. The
   grey above is only the letterbox around the 16:9 slide. */
.reveal .backgrounds .slide-background{background-color:var(--slide-bg,#fff)}
/* "Waiter" overlay: an opaque cover with a spinner that hides the deck until it
   has rendered AND jumped to the right slide, so the cover slide never flashes
   in the live preview. Shown only while embedded; removed by showDeck(). */
#mist-loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;z-index:9999}
.mist-spinner{width:28px;height:28px;border:3px solid #e2e2e2;border-top-color:#999;border-radius:50%;animation:mist-spin .7s linear infinite}
@keyframes mist-spin{to{transform:rotate(360deg)}}
/* Kill the slide/background transition during a programmatic jump so the deck
   lands on the target slide instantly, instead of sliding across from slide 0
   the moment the waiter lifts. */
.no-anim .reveal .slides section,.no-anim .reveal .backgrounds .slide-background{transition:none !important}
`;

/** Map the deck's `navigation-mode:` to a reveal navigationMode. Quarto's
 *  `vertical` is reveal's `default` (up/down walks the stack); `linear` and
 *  `grid` pass through. Default `linear` to match the repo's _quarto.yml. */
function extractNavMode(frontmatter: string): "linear" | "grid" | "default" {
  const m = frontmatter.match(/^\s*navigation-mode:\s*(\w+)/m);
  const v = m ? m[1].toLowerCase() : "linear";
  if (v === "grid") return "grid";
  if (v === "vertical" || v === "default") return "default";
  return "linear";
}

/** A global footer line shown on every slide, from `footer:` (top-level or
 *  nested under format.revealjs, both reached by the multiline match). Plain
 *  text; empty/missing means no footer. */
function extractFooter(frontmatter: string): string {
  const m = frontmatter.match(/^\s*footer:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** Reveal's slideNumber config from `slide-number:` (default off). `true` ->
 *  'c/t' (current/total); a format string like 'c/t' or 'h.v' passes through. */
function extractSlideNumber(frontmatter: string): string {
  const m = frontmatter.match(/^\s*slide-number:\s*(.+)$/m);
  if (!m) return "false";
  const v = m[1].trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (v === "true" || v === "yes") return "'c/t'";
  if (v === "false" || v === "no" || v === "") return "false";
  return `'${v.replace(/'/g, "")}'`;
}

/** Pull a frontmatter key's path entries, in inline (`key: a` / `key: [a, b]`)
 *  or YAML list form. Used for `css:` and `bibliography:`. */
function extractFmPaths(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split("\n");
  const paths: string[] = [];
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline) {
      const items = inline.startsWith("[") ? inline.replace(/[[\]]/g, "").split(",") : [inline];
      for (const it of items) {
        const v = it.trim().replace(/['"]/g, "");
        if (v) paths.push(v);
      }
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") continue;
        const item = lines[j].match(/^\s*-\s*(.+)$/);
        if (!item) break;
        paths.push(item[1].trim().replace(/['"]/g, ""));
      }
    }
  }
  return paths;
}

/** Pull the deck's `css:` entries from the frontmatter (inline or list form). */
export function extractCssPaths(frontmatter: string): string[] {
  return extractFmPaths(frontmatter, "css");
}

/** Pull the deck's `bibliography:` entries (paths relative to the doc's folder,
 *  like `css:`), so the bib can be resolved directly instead of folder-guessed. */
export function extractBibPaths(frontmatter: string): string[] {
  return extractFmPaths(frontmatter, "bibliography");
}

function cssUrl(
  path: string,
  drive: DriveMeta | null,
  origin: string,
  driveToken: string,
): string | null {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/") || path.toLowerCase().endsWith(".scss")) return null;
  if (drive && driveToken) return driveAssetUrl(drive, origin, path, driveToken);
  return null;
}

/** Pull raw `<style>...</style>` blocks out of the body so reveal does not show
 *  them as text; Quarto hoists such inline CSS to the page head, so do the same. */
function extractStyleBlocks(md: string): { body: string; styles: string } {
  const blocks: string[] = [];
  const body = md.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
    blocks.push(css);
    return "";
  });
  return { body, styles: blocks.length ? `<style>${blocks.join("\n")}</style>` : "" };
}

export interface BuildSlidesOptions {
  drive: DriveMeta | null;
  origin: string;
  driveToken: string;
  /** Cache-bust token for the deck CSS links. */
  bust: string;
  /** The doc's own frontmatter; falls back to any the markdown carries. */
  docFrontmatter: string;
  /** BibTeX library: when present, `[@key]` citations render as inline APA and a
   *  References slide is appended, matching the document preview. */
  bibLib?: BibLibrary | null;
  /** Print-to-PDF: when false, a slide's fragments collapse onto ONE page (the
   *  fully-revealed state) instead of reveal's default one page per fragment
   *  step. Lets an animated deck print one page per slide. Default true. */
  pdfSeparateFragments?: boolean;
}

/**
 * The `<section>` markup for the whole deck (the `.slides` innerHTML), split out
 * so the live preview can re-render in place (postMessage) without reloading the
 * iframe. Nest deeper slides under each `#` section so reveal draws a 2D grid; a
 * single-slide group stays a flat horizontal section, a multi-slide group is
 * wrapped in an outer <section> (reveal's vertical stack).
 */
export function buildSlideSections(md: string, opts: BuildSlidesOptions): string {
  const { drive, origin, driveToken } = opts;
  const { body: rawBody } = stripFrontmatter(md);
  const ctx: AssetCtx = { drive, origin, driveToken };
  const { body: bodyNoStyles } = extractStyleBlocks(rawBody);
  let body = stripCritic(bodyNoStyles);
  // Convert [@key] citations to inline APA, collecting the keys used for the
  // References slide, exactly as the document preview does.
  let usedKeys: Set<string> | null = null;
  if (opts.bibLib) {
    const cited = convertCitations(body, opts.bibLib);
    body = cited.text;
    usedKeys = cited.usedKeys;
  }
  body = rewriteImages(body, ctx); // relative images -> Drive proxy URLs
  const sections = groupSlides(splitSlides(body))
    .map((group) =>
      group.length === 1
        ? buildSection(group[0], ctx)
        : `<section>\n${group.map((s) => buildSection(s, ctx)).join("\n")}\n</section>`,
    )
    .join("\n");
  // Append a References slide (raw HTML, not data-markdown) when citations were
  // used. .references-slide can be styled by the deck CSS.
  if (opts.bibLib && usedKeys && usedKeys.size) {
    const refs = formatReferenceList(usedKeys, opts.bibLib);
    if (refs) {
      return `${sections}\n<section class="references-slide" style="text-align:left;font-size:0.5em"><h2 style="text-align:center">References</h2>${refs}</section>`;
    }
  }
  return sections;
}

export function buildSlidesHtml(md: string, opts: BuildSlidesOptions): string {
  const { drive, origin, driveToken, bust, docFrontmatter } = opts;
  const separateFragments = opts.pdfSeparateFragments !== false;
  const { frontmatter: editorFm, body: rawBody } = stripFrontmatter(md);
  const frontmatter = docFrontmatter || editorFm;
  const { styles: inlineStyles } = extractStyleBlocks(rawBody);
  const sections = buildSlideSections(md, opts);

  const navigationMode = extractNavMode(frontmatter);
  const slideNumber = extractSlideNumber(frontmatter);
  const footer = extractFooter(frontmatter);
  const footerHtml = footer
    ? `<div class="deck-footer">${footer.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
    : "";
  const deckCss = extractCssPaths(frontmatter)
    .map((p) => cssUrl(p, drive, origin, driveToken))
    .filter((u): u is string => u !== null)
    .map((u) => `<link rel="stylesheet" href="${u}${u.includes("?") ? "&" : "?"}cb=${bust}">`)
    .join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<style>${PREVIEW_CSS}</style>
<style id="deck-base">${DECK_BASE_CSS}</style>
<style id="deck-theme">${themeCss(frontmatter)}</style>
${deckCss}
${inlineStyles}
</head><body>
<div id="mist-loading"><div class="mist-spinner"></div></div>
<div class="reveal"><div class="slides">${sections}</div>${footerHtml}</div>
<script>
// Runs during parse, before the blocking reveal.js download, so the raw slide
// markup never paints. The waiter overlay is opaque by default (CSS), covering
// everything from the first frame. Keep it (and hide the deck) only while
// embedded in the editor; the standalone print page drops it at once.
(function(){
  var embedded = window.parent !== window;
  var l = document.getElementById('mist-loading');
  var r = document.querySelector('.reveal');
  if (embedded) {
    if (r) r.style.visibility = 'hidden';
    // Mark the embedded preview so the letterbox area can be tinted light grey
    // (the print/PDF page keeps a plain white page).
    document.documentElement.classList.add('mist-embedded');
  }
  else if (l) { l.style.display = 'none'; }
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/markdown/markdown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/notes/notes.js"></script>
<script>
// scrollActivationWidth:null stops reveal v5 auto-switching to scroll view in a
// narrow pane (the split), which in a sandboxed iframe hits sessionStorage and
// blanks the deck.
// width/height fix a 16:9 widescreen slide that reveal scales as a unit, so the
// preview letterboxes instead of reflowing to the pane shape.
// Keep reveal's own controls, progress bar, overview (O) and keyboard
// shortcuts (F fullscreen, S notes, arrows) on, and add the hamburger menu
// plugin if it loaded (best-effort, like Quarto's decks).
var revealPlugins=[RevealMarkdown,RevealNotes];
// Cursor-driven sync: the editor posts {type:"mist-goto", h} as the cursor
// moves and after each rebuild. Buffer the target so a message that arrives
// before reveal is ready (e.g. right after the iframe reloads) still lands,
// which is what keeps an edit from snapping the deck back to slide 1.
var pendingGoto = null, pendingFrag = -1, revealReady = false;
// The deck and waiter overlay are set up by the early script above (hidden while
// embedded). showDeck() lifts the waiter and reveals the deck once it has
// rendered and jumped to the right slide, so the cover slide never flashes.
var deckEl = document.querySelector('.reveal');
var loadingEl = document.getElementById('mist-loading');
var deckShown = false;
function showDeck(){
  if (deckShown || !revealReady) return;
  deckShown = true;
  if (deckEl) deckEl.style.visibility = '';
  if (loadingEl) loadingEl.style.display = 'none';
}
// The editor sends a flat slide index (its split is flat). With 2D nesting a
// flat index is not reveal's horizontal index, so map it through the slide
// element to reveal's (h,v). f is the reveal fragment to reveal up to (the
// editor's cursor fragment), or <0 for none, so the deck follows the cursor down
// to the fragment being edited.
function gotoFlat(n, f){
  var slides = Reveal.getSlides();
  if (!slides.length) return;
  if (n < 0) n = 0; else if (n >= slides.length) n = slides.length - 1;
  var idx = Reveal.getIndices(slides[n]);
  var cur = Reveal.getIndices();
  // Only navigate when the slide actually changes, and then with no transition
  // (the cursor-driven follow should snap, not animate). Re-navigating the same
  // slide would reset its fragments and flash.
  if (cur.h !== idx.h || cur.v !== idx.v) {
    document.body.classList.add('no-anim');
    Reveal.slide(idx.h, idx.v);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ document.body.classList.remove('no-anim'); }); });
  }
  // Drive fragments explicitly. Reveal.slide's fragment argument only lands on a
  // slide change, so moving the cursor between fragments of the SAME slide needs
  // this. navigateFragment(index) jumps straight to a fragment index (reveal v5);
  // fall back to stepping with next/prevFragment. Both act on the current slide.
  var target = (typeof f === 'number') ? f : -1;
  if (typeof Reveal.navigateFragment === 'function') {
    Reveal.navigateFragment(target);
  } else {
    var fi = Reveal.getIndices().f; if (typeof fi !== 'number') fi = -1;
    var guard = 0;
    while (fi < target && guard++ < 500 && Reveal.nextFragment()) fi++;
    while (fi > target && guard++ < 500 && Reveal.prevFragment()) fi--;
  }
}
function applyGoto(){ if (revealReady && pendingGoto != null) gotoFlat(pendingGoto, pendingFrag); }
// Mermaid is best-effort and must never block reveal. Skip the import entirely
// unless the deck actually has a mermaid block, which saves loading and running
// a large module on a deck that has none. Reused by init and in-place rerender.
async function runMermaid(){
  if (!document.querySelector("code.language-mermaid")) return 0;
  var mt = performance.now ? performance.now() : 0;
  try {
    const m = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    m.default.initialize({ startOnLoad: false, theme: "neutral" });
    document.querySelectorAll("code.language-mermaid").forEach(function (c) {
      const d = document.createElement("div");
      d.className = "mermaid";
      d.textContent = c.textContent || "";
      (c.closest("pre") || c).replaceWith(d);
    });
    await m.default.run({ querySelector: ".mermaid" });
    Reveal.layout();
  } catch (e) { /* slides render fine without mermaid */ }
  return Math.round((performance.now ? performance.now() : 0) - mt);
}
// Shared reveal config and handlers, used by both the initial boot and the
// in-place rebuild so both produce an identical deck.
// center:false matches Quarto (reveal's own default is true). With centring on,
// every slide's content block is vertically centred, which drags a
// bottom-pinned .shot-cap caption up to the middle; off, slides top-align.
// keyboard:{27:null} unbinds Esc so it no longer toggles overview: in fullscreen
// the browser swallows Esc (it exits fullscreen), so leaving Esc on overview made
// it work in one place and not the other. Overview is now O only (reveal default).
var REVEAL_CONFIG = {plugins:revealPlugins,hash:false,controls:true,progress:true,slideNumber:${slideNumber},keyboard:{27:null},overview:true,center:false,navigationMode:'${navigationMode}',pdfSeparateFragments:${separateFragments},scrollActivationWidth:null,width:1280,height:720};
function relayout(){ try { Reveal.layout(); } catch (e) {} }
// Re-run layout across a few frames. In a sandboxed iframe reveal can init
// before the pane has its real size, leaving the deck unscaled; these catch it.
function relayoutBurst(){ relayout(); requestAnimationFrame(relayout); setTimeout(relayout, 120); setTimeout(relayout, 400); }
// Report the current slide to the parent as a flat index (matching the editor's
// flat split) so the URL ?slide= round-trips through 2D nesting.
var slideChangedHandler = function(){ try { parent.postMessage({ type: 'mist-slide', h: Reveal.getSlides().indexOf(Reveal.getCurrentSlide()) }, '*'); } catch (e) {} };

// In-place rebuild: swap the .slides markup, then DESTROY and re-initialise
// reveal, so the deck is rebuilt by the EXACT same path as a fresh load. Running
// only the markdown plugin (md.init) re-processed the sections wrongly and
// inflated the slide count, which shifted every index; a full re-init produces
// the same slide list the reload path does. The CDN scripts stay loaded, so it
// is still far cheaper than reloading the iframe.
var rerendering = false;
// The latest render that arrived before reveal was ready (or while a rebuild was
// in flight). Buffer it instead of dropping it, so content posted in the gap
// after a reload (deploy / stale-tab reconnect) is not lost, which showed as a
// blank preview that needed several reloads. Drained when ready / on finish.
var pendingRender = null;
function drainRender(){
  if (pendingRender) { var pr = pendingRender; pendingRender = null; rerender(pr.html, pr.target); }
}
async function rerender(html, target){
  if (!revealReady || rerendering) { pendingRender = { html: html, target: target }; return; }
  var slidesEl = document.querySelector(".slides");
  if (!slidesEl) return;
  rerendering = true;
  // Where the deck shows now, captured before the rebuild. For a content edit
  // (slide count unchanged) we return to exactly this slide.
  var before = Reveal.getSlides().length;
  var shown = Reveal.getSlides().indexOf(Reveal.getCurrentSlide());
  // Hide the deck while it re-initialises: destroy + initialize resets reveal to
  // slide 0 and paints it before we jump back, which flashes the cover slide.
  // Revealing only after the jump means the rebuild lands silently on the right
  // slide. Width/height are preserved (visibility, not display), so layout holds.
  if (deckEl) deckEl.style.visibility = 'hidden';
  revealReady = false;
  // try/finally so a throw in destroy/initialize/goto can never leave the deck
  // hidden (which showed as no preview at all). The deck is always revealed.
  try {
    try { Reveal.off('slidechanged', slideChangedHandler); } catch (e) {}
    try { await Reveal.destroy(); } catch (e) {}
    slidesEl.innerHTML = html;
    await Reveal.initialize(REVEAL_CONFIG);
    if (Reveal.sync) Reveal.sync();
    Reveal.on('slidechanged', slideChangedHandler);
    relayoutBurst();
    var after = Reveal.getSlides().length;
    // Content edit: keep the shown slide. Structural edit (count changed): the
    // shown index has shifted, so use the parent's cursor-derived target.
    var dest = (after === before && shown >= 0)
      ? shown
      : (typeof target === "number" && target >= 0 ? target : shown);
    if (dest >= 0) { pendingGoto = dest; gotoFlat(dest); }
    Reveal.layout();
  } catch (e) {
    // best-effort: leave whatever rendered rather than wedging the deck
  } finally {
    revealReady = true;
    if (deckEl) deckEl.style.visibility = '';
    rerendering = false;
  }
  await runMermaid();
  drainRender(); // apply a render that arrived during this rebuild
}
window.addEventListener("message", function(e){
  if (!e.data) return;
  if (e.data.type === "mist-goto" && typeof e.data.h === "number") {
    pendingGoto = e.data.h; pendingFrag = (typeof e.data.f === "number") ? e.data.f : -1; applyGoto(); showDeck();
  } else if (e.data.type === "mist-render" && typeof e.data.sections === "string") {
    rerender(e.data.sections, typeof e.data.goto === "number" ? e.data.goto : null);
  }
});
// Forward mod+alt layout shortcuts to the parent: this sandboxed iframe has its
// own window, so its key events never reach the app otherwise. Reveal's own keys
// carry no modifier, so they are untouched.
window.addEventListener("keydown", function(e){
  var alt = e.altKey || (e.getModifierState && e.getModifierState("AltGraph"));
  if (!(e.ctrlKey || e.metaKey) || !alt) return;
  var c = e.code, chord = null;
  if (c.indexOf("Key") === 0) chord = c.slice(3).toLowerCase();
  else if (c.indexOf("Digit") === 0) chord = c.slice(5);
  else if (c.indexOf("Numpad") === 0 && /\\d$/.test(c)) chord = c.slice(-1);
  else if (c === "BracketLeft") chord = "[";
  else if (c === "BracketRight") chord = "]";
  else if (c === "Minus") chord = "-";
  else if (c === "Equal") chord = "=";
  else if (c === "Slash") chord = "/";
  if (chord) {
    // Stop reveal's own keydown (S notes, F fullscreen, O overview) from also
    // firing on the same chord; we are in capture, so this pre-empts it.
    e.preventDefault();
    e.stopImmediatePropagation();
    parent.postMessage({ type: "mist-key", chord: chord }, "*");
  }
}, true);
// In overview, let the mouse wheel page through slides. Reveal navigates the
// overview grid by arrow keys only and the pane has no scrollbar, so a plain
// wheel does nothing; throttle so one notch moves one slide.
var wheelLock = false;
window.addEventListener("wheel", function(e){
  if (!(Reveal.isOverview && Reveal.isOverview())) return;
  e.preventDefault();
  if (wheelLock) return;
  wheelLock = true;
  setTimeout(function(){ wheelLock = false; }, 180);
  if (e.deltaY > 0) Reveal.next(); else if (e.deltaY < 0) Reveal.prev();
}, { passive: false });
Reveal.initialize(REVEAL_CONFIG).then(async function(){
  // Rebuild slide backgrounds: the markdown plugin sets data-background-image
  // (from the <!-- .slide: --> comment) during init, after reveal first built
  // its background layer, so without a sync the backgrounds come up blank.
  if (Reveal.sync) Reveal.sync();
  revealReady = true; applyGoto();
  // Reveal only once we are on the right slide, so the cover slide never flashes.
  // If the goto already arrived, reveal now. Otherwise ASK the parent for the
  // slide to open on (a pull, reliable because our listener is attached) and
  // reveal when it answers (handled in the message listener). A long safety
  // timeout reveals regardless, so a missing answer can never leave a rendered
  // deck hidden behind the white overlay.
  if (pendingGoto != null) {
    showDeck();
  } else {
    try { parent.postMessage({ type: "mist-need-goto" }, "*"); } catch (e) {}
    setTimeout(showDeck, 1500);
  }
  Reveal.on('slidechanged', slideChangedHandler);
  relayoutBurst();
  // ResizeObserver / resize live on body+window (not cleared by Reveal.destroy),
  // so attach them once here, not on every in-place rebuild.
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(document.body);
  window.addEventListener("resize", relayout);
  await runMermaid();
  drainRender(); // apply any render that arrived before reveal finished booting
});
</script>
</body></html>`;
}
