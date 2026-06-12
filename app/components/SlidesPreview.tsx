import { useMemo, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Browser slides preview for `.qmd` / RevealJS decks. Presentational, not a
 * Quarto render: it translates the common Quarto layout syntax (column fenced
 * divs, fragments, slide background/class attributes, notes, callouts) into
 * reveal.js HTML and shows it with real reveal.js (from a CDN) in a sandboxed
 * iframe. Deliberately simple: it uses default styling rather than loading a
 * deck's own CSS, and executed code or Quarto-specific features do not appear.
 */

function stripFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { frontmatter: m[1], body: md.slice(m[0].length) } : { frontmatter: "", body: md };
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
function parseHeading(line: string): { heading: string; classAttr: string; bgAttr: string } {
  const m = line.match(/^(#{1,6})\s*(.*?)\s*\{([^}]*)\}\s*$/);
  if (!m) return { heading: line, classAttr: "", bgAttr: "" };
  const [, hashes, text, attr] = m;
  const classes = classesFrom(attr);
  const bg: string[] = [];
  for (const key of ["background-color", "background-image", "background-size", "background-position"]) {
    const v = attr.match(new RegExp(`${key}="([^"]+)"`));
    if (v) bg.push(`data-${key}="${v[1]}"`);
  }
  const heading = text ? `${hashes} ${text}` : ""; // drop empty (e.g. .no-title) headings
  return { heading, classAttr: classes.length ? ` class="${classes.join(" ")}"` : "", bgAttr: bg.join(" ") };
}

/** Turn Quarto `::: {.columns}` fenced divs into real div/aside elements. */
function convertDivs(md: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of md.split("\n")) {
    const open = line.match(/^:::+\s*\{([^}]*)\}\s*$/);
    const close = /^:::+\s*$/.test(line);
    if (open) {
      const classes = classesFrom(open[1]);
      const isNotes = classes.includes("notes");
      const tag = isNotes ? "aside" : "div";
      const width = open[1].match(/width="?([\d.]+%?)"?/);
      const style = width ? ` style="width:${width[1]}"` : "";
      stack.push(tag);
      out.push("", `<${tag} class="${classes.join(" ")}"${style}>`, "");
    } else if (close && stack.length) {
      out.push("", `</${stack.pop()}>`, "");
    } else {
      out.push(line);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("\n");
}

/** Inline `[text]{.fragment}` spans. */
function convertSpans(md: string): string {
  return md.replace(/\[([^\]]+)\]\{([^}]*)\}/g, (_w, text: string, attr: string) => {
    const cls = classesFrom(attr).join(" ");
    return cls ? `<span class="${cls}">${text}</span>` : text;
  });
}

function buildSection(slideMd: string): string {
  const lines = slideMd.split("\n");
  let classAttr = "";
  let bgAttr = "";
  let body = slideMd;
  if (/^#{1,6}\s/.test(lines[0] ?? "")) {
    const parsed = parseHeading(lines[0]);
    classAttr = parsed.classAttr;
    bgAttr = parsed.bgAttr;
    body = [parsed.heading, ...lines.slice(1)].join("\n");
  }
  const inner = convertDivs(convertSpans(body)).replace(/<\/textarea>/gi, "&lt;/textarea&gt;");
  return `<section${classAttr}${bgAttr ? " " + bgAttr : ""} data-markdown><textarea data-template>\n${inner}\n</textarea></section>`;
}

const PREVIEW_CSS = `
html,body{margin:0;height:100%}
.columns{display:flex;gap:1em;align-items:flex-start}
.column{flex:1}
.callout{border:1px solid #ccc;border-radius:6px;padding:.5em .75em;margin:.5em 0;text-align:left}
.callout-note{border-left:4px solid #4a90d9}
.callout-tip{border-left:4px solid #3aa76d}
.callout-warning,.callout-important{border-left:4px solid #e0a800}
`;

function buildHtml(md: string): string {
  const body = stripCritic(stripFrontmatter(md).body);
  const sections = splitSlides(body).map(buildSection).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
<style>${PREVIEW_CSS}</style>
</head><body>
<div class="reveal"><div class="slides">${sections}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/markdown/markdown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
<script>Reveal.initialize({plugins:[RevealMarkdown,RevealNotes],hash:false});</script>
</body></html>`;
}

export default function SlidesPreview() {
  const { markdown, github } = useDocument();
  const [open, setOpen] = useState(false);

  const isDeck = useMemo(() => {
    if (github?.path?.toLowerCase().endsWith(".qmd")) return true;
    return stripFrontmatter(markdown).frontmatter.toLowerCase().includes("revealjs");
  }, [github, markdown]);

  const html = useMemo(() => (open ? buildHtml(markdown) : ""), [open, markdown]);

  if (!isDeck) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Slides preview"
        className="flex shrink-0 items-center border-l border-border px-3 text-sm font-medium transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        Slides
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
            <span className="font-medium">Slides preview (presentational, not a Quarto render)</span>
            <button type="button" onClick={() => setOpen(false)} className="px-2 text-lg leading-none" aria-label="Close slides">
              &times;
            </button>
          </div>
          <iframe title="Slides preview" sandbox="allow-scripts" srcDoc={html} className="flex-1 border-0" />
        </div>
      )}
    </>
  );
}
