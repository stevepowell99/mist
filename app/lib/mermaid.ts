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
 * Each diagram is rendered on its own, so one that fails to parse shows its error
 * and the rest of the page still gets its diagrams.
 */
type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  run: (opts: { nodes: HTMLElement[] }) => Promise<void>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

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
  const nodes: HTMLElement[] = [];
  for (const c of blocks) {
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = c.textContent ?? "";
    (c.closest("pre") ?? c).replaceWith(div);
    nodes.push(div);
  }

  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
  } catch {
    return; // leave the source text in place if mermaid itself fails to load
  }
  for (const node of nodes) {
    try {
      await mermaid.run({ nodes: [node] });
    } catch {
      // A diagram mermaid cannot parse keeps its source; the others still render.
    }
  }
}
