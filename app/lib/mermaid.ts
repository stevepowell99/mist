/**
 * Render any ```mermaid code blocks inside a container into diagrams. marked (and
 * reveal's markdown plugin) emit them as <code class="language-mermaid">; this
 * converts them to <div class="mermaid"> and runs mermaid, loaded from a CDN on
 * first use. Client-only.
 */
type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  run: (opts: { nodes: HTMLElement[] }) => Promise<void>;
};

const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ MERMAID_URL).then((m) => {
      const api = m.default as MermaidApi;
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
  try {
    const mermaid = await loadMermaid();
    await mermaid.run({ nodes });
  } catch {
    // leave the source text in place if mermaid fails to load or parse
  }
}
