import { useMemo, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Browser slides preview for `.qmd` / RevealJS decks. This is a presentational
 * preview, not a Quarto render: it splits the markdown into slides and shows
 * them with real reveal.js (loaded from a CDN) inside a sandboxed iframe, so it
 * stays isolated from the app. Executed code chunks and Quarto-specific
 * features only appear in the authoritative Quarto build, not here.
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

function buildHtml(md: string): string {
  const body = stripCritic(stripFrontmatter(md).body);
  const sections = splitSlides(body)
    .map((s) => {
      const safe = s.replace(/<\/textarea>/gi, "&lt;/textarea&gt;");
      return `<section data-markdown><textarea data-template>\n${safe}\n</textarea></section>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
<style>html,body{margin:0;height:100%}</style>
</head><body>
<div class="reveal"><div class="slides">${sections}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/markdown/markdown.js"></script>
<script>Reveal.initialize({plugins:[RevealMarkdown],hash:false});</script>
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
