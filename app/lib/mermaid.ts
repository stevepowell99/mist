/**
 * Render any ```mermaid code blocks inside a container into diagrams. marked (and
 * reveal's markdown plugin) emit them as <code class="language-mermaid">; this
 * converts them to <div class="mermaid"> and runs mermaid. Client-only.
 *
 * Mermaid is BUNDLED (lazily imported from our own build), not fetched from a
 * CDN: a blocked or slow CDN left every diagram sitting there as its own source
 * text, with nothing on the page to say why. It is still a dynamic import, so the
 * weight only lands on a document that actually has a diagram.
 *
 * Rendered SVG is CACHED by diagram source and re-applied synchronously. The
 * preview re-sets its innerHTML whenever the markdown re-renders, which throws
 * away the injected SVG and leaves the code block behind; the diagram then had to
 * be parsed again from scratch, and a re-render arriving mid-parse wrote the
 * result into a node that was already detached, so the diagram appeared and then
 * vanished for good. From the cache it comes straight back in the same frame.
 *
 * Each diagram is rendered on its own, so one that fails to parse keeps its
 * source and the rest of the page still gets its diagrams.
 */
type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
/** diagram source -> rendered SVG, so a re-render costs nothing. */
const svgCache = new Map<string, string>();
let idSeq = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const api = m.default as unknown as MermaidApi;
      api.initialize({ startOnLoad: false, theme: "neutral" });
      return api;
    });
  }
  return mermaidPromise;
}

/** Mermaid's own opening keywords, so a diagram is recognised by WHAT IT IS and
 *  not by the class on its code block. Matching only the class missed real
 *  diagrams (a fence written Quarto-style as ```{mermaid} carries the class
 *  `language-{mermaid}`, and any renderer or sanitizer that drops the class takes
 *  the diagram with it): the block then rendered as its own source text. */
const MERMAID_START =
  /^\s*(?:%%\{|graph\s|flowchart\s|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|quadrantChart\b|gitGraph\b|xychart-beta\b|block-beta\b|sankey-beta\b|C4Context\b)/;

function isMermaidBlock(code: Element): boolean {
  const cls = code.className || "";
  if (/\blanguage-\{?mermaid\}?\b/.test(cls)) return true;
  // No class to go on: read the source. Only inside a fenced block, so a prose
  // paragraph that happens to start with "graph " is never touched.
  return code.closest("pre") !== null && MERMAID_START.test(code.textContent ?? "");
}

export async function runMermaid(root: HTMLElement | null): Promise<void> {
  if (!root) return;
  const blocks = Array.from(root.querySelectorAll("code")).filter(isMermaidBlock);
  if (blocks.length === 0) return;

  // Swap every block for its container first, filling in from the cache as we go,
  // so an already-seen diagram is back on the page in this frame.
  const pending: { div: HTMLElement; src: string }[] = [];
  for (const code of blocks) {
    const src = (code.textContent ?? "").trim();
    const div = document.createElement("div");
    div.className = "mermaid";
    const cached = svgCache.get(src);
    if (cached) {
      div.innerHTML = cached;
    } else {
      div.textContent = src;
      pending.push({ div, src });
    }
    (code.closest("pre") ?? code).replaceWith(div);
  }
  if (pending.length === 0) return;

  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
  } catch {
    return; // leave the source text in place if mermaid itself fails to load
  }
  for (const { div, src } of pending) {
    try {
      const { svg } = await mermaid.render(`mermaid-${idSeq++}`, src);
      svgCache.set(src, svg);
      // The preview may have re-rendered while this was parsing, detaching the
      // node. The cache above means the next pass picks the SVG up regardless.
      if (div.isConnected) div.innerHTML = svg;
    } catch {
      // A diagram mermaid cannot parse keeps its source; the others still render.
    }
  }
}
