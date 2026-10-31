import { showPanel, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { countText } from "./word-count";

/**
 * A small word and character count at the editor's bottom right: the whole
 * file, or the selection against the whole file while text is selected. It is
 * a CodeMirror bottom panel, so it stays at the foot of the visible pane as the
 * document scrolls and stacks with the search panel rather than covering it;
 * the look is `.cm-wordcount` in app.css. Counting is debounced, because a long
 * document takes a few milliseconds to count and typing should not pay that on
 * every key.
 */
export const wordCount = showPanel.of((view: EditorView): Panel => {
  const dom = document.createElement("div");
  dom.className = "cm-wordcount";
  const label = dom.appendChild(document.createElement("span"));
  label.title =
    "Counts the visible text: frontmatter, comments, deletions, link targets, images and markdown marks are left out";
  let docCount: { words: number; chars: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const { state } = view;
    docCount ??= countText(state.doc.toString());
    const n = (x: number) => x.toLocaleString("en-GB");
    const ranges = state.selection.ranges.filter((r) => !r.empty);
    if (!ranges.length) {
      label.textContent = `${n(docCount.words)} words · ${n(docCount.chars)} chars`;
      return;
    }
    const sel = countText(ranges.map((r) => state.sliceDoc(r.from, r.to)).join("\n"));
    label.textContent = `${n(sel.words)} of ${n(docCount.words)} words · ${n(sel.chars)} of ${n(docCount.chars)} chars`;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  };
  render();

  return {
    dom,
    update(u: ViewUpdate) {
      if (u.docChanged) docCount = null;
      if (u.docChanged || u.selectionSet) schedule();
    },
    destroy: () => clearTimeout(timer),
  };
});
