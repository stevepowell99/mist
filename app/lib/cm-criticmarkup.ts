import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { criticSpans, type CriticType } from "./critic";

/**
 * CriticMarkup rendering for the CodeMirror 6 / Y.Text core (#13). The document
 * holds the raw markdown including literal CriticMarkup delimiters, so unlike
 * the old TipTap mark model there is nothing to reconstruct: we scan the text
 * (`criticSpans`, the shared grammar in `critic.ts`) and decorate the spans.
 * Classes match the existing CSS (`cm-addition`, `cm-deletion`, `cm-comment`,
 * `cm-highlight`, `cm-delimiter`), so the editor, clean view and dark-mode
 * styles all carry over unchanged.
 */

const CONTENT_CLASS: Record<CriticType, string> = {
  addition: "cm-addition",
  deletion: "cm-deletion",
  substitution: "cm-addition",
  highlight: "cm-highlight",
  comment: "cm-comment",
};

const delim = Decoration.mark({ class: "cm-delimiter" });

/** Decorations for the spans within [from, to) of the view's document. */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Decorate per visible range, but parse from the line start so a span that
  // begins just above the viewport is still matched.
  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).from;
    const endLine = view.state.doc.lineAt(to).to;
    const text = view.state.doc.sliceString(startLine, endLine);
    const spans = criticSpans(text, startLine);
    for (const s of spans) {
      if (s.type === "substitution") {
        const sep = s.sep!;
        builder.add(s.from, s.contentFrom, delim);
        builder.add(s.contentFrom, sep.from, Decoration.mark({ class: "cm-deletion" }));
        builder.add(sep.from, sep.to, delim);
        builder.add(sep.to, s.contentTo, Decoration.mark({ class: "cm-addition" }));
        builder.add(s.contentTo, s.to, delim);
        continue;
      }
      builder.add(s.from, s.contentFrom, delim);
      builder.add(s.contentFrom, s.contentTo, Decoration.mark({ class: CONTENT_CLASS[s.type] }));
      builder.add(s.contentTo, s.to, delim);
    }
  }
  return builder.finish();
}

/** CodeMirror extension that styles CriticMarkup spans in the visible document. */
export const criticMarkup = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
