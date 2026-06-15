/**
 * Pure builder that turns deck markdown (Quarto/RevealJS syntax) into a complete
 * reveal.js HTML document. Shared by the inline SlidesView (iframe srcDoc) and
 * the server-rendered print route, so both produce identical decks. No React or
 * browser globals, so it runs on the worker too.
 */
import { resolveAssetPath } from "~/lib/github";
import { driveAssetUrl, resolveAssetSrc, rewriteImages, type AssetCtx } from "~/lib/asset-urls";
import type { DriveMeta, GitHubMeta } from "~/shared/types";

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

/** Turn Quarto `::: {...}` fenced divs into real div/aside elements. */
function convertDivs(md: string): string {
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
function convertImages(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\{([^}]*)\}/g,
    (_w, alt: string, url: string, attr: string) => {
      const { classes, id, style } = parseAttrs(attr);
      return `<img src="${url}" alt="${alt}"${attrString(classes, id, style)}>`;
    },
  );
}

/** Inline `[text]{.flare .blue}` spans, carrying classes, id and style. */
function convertSpans(md: string): string {
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
  const inner = convertDivs(convertImages(convertSpans(body))).replace(/<\/textarea>/gi, "&lt;/textarea&gt;");
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
/* A full-bleed background slide pins its caption with position:absolute;
   bottom:0, which only reaches the slide edge if the section fills the stage
   height. Reveal leaves a short slide at content height (so the caption rides up
   to the top), so stretch any slide that carries a .shot-cap. */
.reveal .slides section:has(.shot-cap){height:100%}
`;

const REVEAL_THEMES = new Set([
  "white", "black", "league", "beige", "night", "serif", "simple", "solarized", "blood", "moon", "dracula", "sky",
]);

function extractTheme(frontmatter: string): string {
  const m = frontmatter.match(/^\s*theme:\s*(.+)$/m);
  if (!m) return "white";
  let t = m[1].trim();
  if (t.startsWith("[")) t = t.replace(/[[\]]/g, "").split(",")[0]?.trim() ?? "white";
  t = t.replace(/['"]/g, "");
  if (t === "default") return "white";
  return REVEAL_THEMES.has(t) ? t : "white";
}

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

/** Pull the deck's `css:` entries from the frontmatter (inline or list form). */
function extractCssPaths(frontmatter: string): string[] {
  const lines = frontmatter.split("\n");
  const paths: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*css:\s*(.*)$/);
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

function ghJsdelivr(github: GitHubMeta, repoPath: string): string {
  const enc = repoPath.split("/").map(encodeURIComponent).join("/");
  return `https://cdn.jsdelivr.net/gh/${github.owner}/${github.repo}@${github.branch}/${enc}`;
}

function cssUrl(
  path: string,
  github: GitHubMeta | null,
  drive: DriveMeta | null,
  origin: string,
  driveToken: string,
): string | null {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/") || path.toLowerCase().endsWith(".scss")) return null;
  if (github) return ghJsdelivr(github, resolveAssetPath(github.path, path));
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
  github: GitHubMeta | null;
  drive: DriveMeta | null;
  origin: string;
  driveToken: string;
  /** Cache-bust token for the deck CSS links. */
  bust: string;
  /** The doc's own frontmatter; falls back to any the markdown carries. */
  docFrontmatter: string;
}

export function buildSlidesHtml(md: string, opts: BuildSlidesOptions): string {
  const { github, drive, origin, driveToken, bust, docFrontmatter } = opts;
  const { frontmatter: editorFm, body: rawBody } = stripFrontmatter(md);
  const frontmatter = docFrontmatter || editorFm;
  const ctx: AssetCtx = { github, drive, origin, driveToken };
  const { body: bodyNoStyles, styles: inlineStyles } = extractStyleBlocks(rawBody);
  let body = stripCritic(bodyNoStyles);
  body = rewriteImages(body, ctx); // relative images -> backend URLs (GitHub raw / Drive proxy)
  // Nest deeper slides under each `#` section so reveal draws a 2D grid; a
  // single-slide group stays a flat horizontal section, a multi-slide group is
  // wrapped in an outer <section> (reveal's vertical stack).
  const sections = groupSlides(splitSlides(body))
    .map((group) =>
      group.length === 1
        ? buildSection(group[0], ctx)
        : `<section>\n${group.map((s) => buildSection(s, ctx)).join("\n")}\n</section>`,
    )
    .join("\n");

  const theme = extractTheme(frontmatter);
  const navigationMode = extractNavMode(frontmatter);
  const deckCss = extractCssPaths(frontmatter)
    .map((p) => cssUrl(p, github, drive, origin, driveToken))
    .filter((u): u is string => u !== null)
    .map((u) => `<link rel="stylesheet" href="${u}${u.includes("?") ? "&" : "?"}cb=${bust}">`)
    .join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${theme}.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js-menu@2/menu.css">
<style>${PREVIEW_CSS}</style>
${deckCss}
${inlineStyles}
</head><body>
<div class="reveal"><div class="slides">${sections}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/markdown/markdown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js-menu@2/menu.js"></script>
<script>
// scrollActivationWidth:null stops reveal v5 auto-switching to scroll view in a
// narrow pane (the split), which in a sandboxed iframe hits sessionStorage and
// blanks the deck.
// width/height fix a 16:9 widescreen slide that reveal scales as a unit, so the
// preview letterboxes instead of reflowing to the pane shape.
// Keep reveal's own controls, progress bar, overview (Esc/O) and keyboard
// shortcuts (F fullscreen, S notes, arrows) on, and add the hamburger menu
// plugin if it loaded (best-effort, like Quarto's decks).
var revealPlugins=[RevealMarkdown,RevealNotes];
if (window.RevealMenu) revealPlugins.push(RevealMenu);
// Cursor-driven sync: the editor posts {type:"mist-goto", h} as the cursor
// moves and after each rebuild. Buffer the target so a message that arrives
// before reveal is ready (e.g. right after the iframe reloads) still lands,
// which is what keeps an edit from snapping the deck back to slide 1.
var pendingGoto = null, revealReady = false;
// The editor sends a flat slide index (its split is flat). With 2D nesting a
// flat index is not reveal's horizontal index, so map it through the slide
// element to reveal's (h,v).
function gotoFlat(n){
  var slides = Reveal.getSlides();
  if (!slides.length) return;
  if (n < 0) n = 0; else if (n >= slides.length) n = slides.length - 1;
  var idx = Reveal.getIndices(slides[n]);
  Reveal.slide(idx.h, idx.v);
}
function applyGoto(){ if (revealReady && pendingGoto != null) gotoFlat(pendingGoto); }
window.addEventListener("message", function(e){
  if (e.data && e.data.type === "mist-goto" && typeof e.data.h === "number") {
    pendingGoto = e.data.h; applyGoto();
  }
});
// center:false matches Quarto (reveal's own default is true). With centring on,
// every slide's content block is vertically centred, which drags a
// bottom-pinned .shot-cap caption up to the middle; off, slides top-align and
// absolute positioning lands where the deck's CSS intends.
Reveal.initialize({plugins:revealPlugins,hash:false,controls:true,progress:true,keyboard:true,overview:true,center:false,navigationMode:'${navigationMode}',scrollActivationWidth:null,width:1280,height:720,menu:{openButton:true,openSlideNumber:false,markers:true}}).then(async function(){
  // Rebuild slide backgrounds: the markdown plugin sets data-background-image
  // (from the <!-- .slide: --> comment) during init, after reveal first built
  // its background layer, so without a sync the backgrounds come up blank.
  if (Reveal.sync) Reveal.sync();
  revealReady = true; applyGoto();
  // Report the current slide to the parent as a flat index (matching the
  // editor's flat split) so the URL ?slide= round-trips through 2D nesting.
  Reveal.on('slidechanged', function(){ try { parent.postMessage({ type: 'mist-slide', h: Reveal.getSlides().indexOf(Reveal.getCurrentSlide()) }, '*'); } catch (e) {} });
  // Re-run layout across a few frames. In a sandboxed iframe reveal can init
  // before the pane has its real size (the split is still settling), leaving
  // the deck unscaled, a single tall column. These retries catch that without
  // depending on a resize event firing.
  function relayout(){ try { Reveal.layout(); } catch (e) {} }
  relayout();
  requestAnimationFrame(relayout);
  setTimeout(relayout, 120);
  setTimeout(relayout, 400);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(document.body);
  window.addEventListener("resize", relayout);
  // Mermaid is best-effort and must never block reveal: load it after init and
  // ignore failures.
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
});
</script>
</body></html>`;
}
