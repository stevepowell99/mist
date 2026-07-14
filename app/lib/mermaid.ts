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

export async function runMermaid(root: HTMLElement | null): Promise<void> {
  if (!root) return;
  const blocks = Array.from(root.querySelectorAll("code.language-mermaid"));
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
