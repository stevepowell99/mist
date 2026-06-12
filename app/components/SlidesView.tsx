import { useEffect, useMemo, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImageUrls, resolveImageSrc, resolveAssetPath, rawAssetUrl } from "~/lib/github";
import type { GitHubMeta } from "~/shared/types";

/**
 * Inline slides renderer for `.qmd` / RevealJS decks. It is the Preview for a
 * deck: when Preview is on and the source is a deck, this renders instead of the
 * document Preview. Presentational, not a Quarto render. It translates the
 * common Quarto layout syntax into reveal.js HTML, loads the deck's own theme
 * and CSS for GitHub-backed decks, and shows it with real reveal.js (from a CDN)
 * in a sandboxed iframe. Executed code and Quarto-specific features do not appear.
 */

function stripFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { frontmatter: m[1], body: md.slice(m[0].length) } : { frontmatter: "", body: md };
}

/** True when the document should render as slides rather than a flowing document. */
export function isSlideDeck(markdown: string, github: GitHubMeta | null): boolean {
  if (github?.path?.toLowerCase().endsWith(".qmd")) return true;
  return stripFrontmatter(markdown).frontmatter.toLowerCase().includes("revealjs");
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

function classesFrom(attr: string): string[] {
  return [...attr.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

/** A leading `# Heading {.cls background-color="..."}` becomes section attributes. */
function parseHeading(line: string, github: GitHubMeta | null): { heading: string; classAttr: string; bgAttr: string } {
  const m = line.match(/^(#{1,6})\s*(.*?)\s*\{([^}]*)\}\s*$/);
  if (!m) return { heading: line, classAttr: "", bgAttr: "" };
  const [, hashes, text, attr] = m;
  const classes = classesFrom(attr);
  const bg: string[] = [];
  for (const key of ["background-color", "background-image", "background-size", "background-position"]) {
    const v = attr.match(new RegExp(`${key}="([^"]+)"`));
    if (!v) continue;
    let val = v[1];
    if (key === "background-image" && github) val = resolveImageSrc(val, github) ?? val;
    bg.push(`data-${key}="${val}"`);
  }
  const heading = text ? `${hashes} ${text}` : ""; // drop empty (e.g. .no-title) headings
  return { heading, classAttr: classes.length ? ` class="${classes.join(" ")}"` : "", bgAttr: bg.join(" ") };
}

/** Parse a Pandoc attribute spec: .classes, #id, and key="value" pairs,
 * translating width/height keyvals into the style. This is what carries the
 * deck's component+colour+modifier classes plus style= (used by .place and a
 * custom .scale) through to the rendered HTML. */
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

/** Turn Quarto `::: {...}` fenced divs into real div/aside elements, carrying
 * classes, id and style. Every line beginning with `:::` is consumed, so no
 * fence markers leak; a stack keeps nested cells balanced. */
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
    // a stray closer with nothing open is simply swallowed
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

function buildSection(slideMd: string, github: GitHubMeta | null): string {
  const lines = slideMd.split("\n");
  let classAttr = "";
  let bgAttr = "";
  let body = slideMd;
  if (/^#{1,6}\s/.test(lines[0] ?? "")) {
    const parsed = parseHeading(lines[0], github);
    classAttr = parsed.classAttr;
    bgAttr = parsed.bgAttr;
    body = [parsed.heading, ...lines.slice(1)].join("\n");
  }
  const inner = convertDivs(convertImages(convertSpans(body))).replace(/<\/textarea>/gi, "&lt;/textarea&gt;");
  return `<section${classAttr}${bgAttr ? " " + bgAttr : ""} data-markdown><textarea data-template>\n${inner}\n</textarea></section>`;
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
        const item = lines[j].match(/^\s*-\s*(.+)$/);
        if (!item) break;
        paths.push(item[1].trim().replace(/['"]/g, ""));
      }
    }
  }
  return paths;
}

/** Resolve a deck CSS entry to a URL. Absolute URLs work for any deck; a
 * relative path needs a folder backend (a GitHub repo today) to resolve against. */
function cssUrl(path: string, github: GitHubMeta | null): string | null {
  if (/^https?:\/\//.test(path)) return path;
  if (!github || path.startsWith("/") || path.toLowerCase().endsWith(".scss")) return null;
  return rawAssetUrl(github, resolveAssetPath(github.path, path));
}

function buildHtml(md: string, github: GitHubMeta | null, bust: string): string {
  const { frontmatter, body: rawBody } = stripFrontmatter(md);
  let body = stripCritic(rawBody);
  if (github) body = rewriteImageUrls(body, github); // relative images -> raw GitHub URLs
  const sections = splitSlides(body)
    .map((s) => buildSection(s, github))
    .join("\n");

  const theme = extractTheme(frontmatter);
  const deckCss = extractCssPaths(frontmatter)
    .map((p) => cssUrl(p, github))
    .filter((u): u is string => u !== null)
    // cache-bust so an edited stylesheet is re-fetched rather than served stale
    .map((u) => `<link rel="stylesheet" href="${u}${u.includes("?") ? "&" : "?"}cb=${bust}">`)
    .join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${theme}.css">
<style>${PREVIEW_CSS}</style>
${deckCss}
</head><body>
<div class="reveal"><div class="slides">${sections}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/markdown/markdown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
<script>Reveal.initialize({plugins:[RevealMarkdown,RevealNotes],hash:false});</script>
</body></html>`;
}

export default function SlidesView() {
  const { markdown, github } = useDocument();
  // Rebuilding the iframe reloads reveal, so debounce: refresh ~0.8s after edits
  // settle rather than on every keystroke.
  const [debounced, setDebounced] = useState(markdown);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(markdown), 800);
    return () => clearTimeout(t);
  }, [markdown]);

  // Cache-bust token, set after mount (avoids an SSR/hydration mismatch). A fresh
  // token each time the preview opens re-fetches the deck's CSS rather than using
  // a stale copy.
  const [bust, setBust] = useState("");
  useEffect(() => {
    setBust(Date.now().toString(36)); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const html = useMemo(() => buildHtml(debounced, github, bust), [debounced, github, bust]);

  return (
    <iframe
      title="Slides preview"
      sandbox="allow-scripts"
      srcDoc={html}
      className="block h-full w-full border-0"
    />
  );
}
