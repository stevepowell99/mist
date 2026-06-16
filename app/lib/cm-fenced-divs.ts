import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * Tints Quarto/Pandoc fenced divs (`::: {.class}` ... `:::`) by nesting depth,
 * so nested blocks read as progressively darker bands. A line of only colons
 * closes the current block; colons followed by anything open a new one (same
 * pairing the slides build uses). Depth is tracked from the top of the
 * document, but only visible lines get decorations.
 */
const FENCE = /^\s*(:{3,})(.*)$/;
const fenceLine = [
  null,
  Decoration.line({ class: "cm-fence-d1" }),
  Decoration.line({ class: "cm-fence-d2" }),
  Decoration.line({ class: "cm-fence-d3" }),
  Decoration.line({ class: "cm-fence-d4" }),
  Decoration.line({ class: "cm-fence-d5" }),
  Decoration.line({ class: "cm-fence-d6" }),
];

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const visible = view.visibleRanges;
  const isVisible = (from: number) => visible.some((r) => from >= r.from && from <= r.to);

  let depth = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const m = FENCE.exec(line.text);
    let decoDepth = 0;
    if (m) {
      if (m[2].trim() === "") {
        // closer: this line still belongs to the block it ends
        decoDepth = depth;
        depth = Math.max(0, depth - 1);
      } else {
        depth++;
        decoDepth = depth;
      }
    } else if (depth > 0) {
      decoDepth = depth;
    }
    if (decoDepth > 0 && isVisible(line.from)) {
      builder.add(line.from, line.from, fenceLine[Math.min(decoDepth, 6)]!);
    }
  }
  return builder.finish();
}

export const fencedDivStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
