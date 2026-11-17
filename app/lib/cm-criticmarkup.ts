import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Text } from "@codemirror/state";
import { criticSpans, type CriticSpan, type CriticType } from "./critic";

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

/** The document's spans, scanned once per document version. */
const spanCache = new WeakMap<Text, CriticSpan[]>();
function docSpans(doc: Text): CriticSpan[] {
  let spans = spanCache.get(doc);
  if (!spans) {
    spans = criticSpans(doc.toString());
    spanCache.set(doc, spans);
  }
  return spans;
}

/**
 * Decorations for every span that reaches into the visible ranges.
 *
 * The spans come from the WHOLE document, not from the visible text. A span is
 * only a span once its closing delimiter is found, and a long suggestion (a
 * pasted passage, or several lines typed in suggest mode) closes far below the
 * viewport: scanning only what is on screen left its opener as literal `{++`
 * and its text unstyled. One linear scan per document version is cheap, and
 * scrolling reuses it.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = view.visibleRanges;
  for (const s of docSpans(view.state.doc)) {
    if (!ranges.some((r) => s.from <= r.to && s.to >= r.from)) continue;
    if (s.type === "substitution") {
      const sep = s.sep!;
      builder.add(s.from, s.contentFrom, delim);
      if (sep.from > s.contentFrom) builder.add(s.contentFrom, sep.from, Decoration.mark({ class: "cm-deletion" }));
      builder.add(sep.from, sep.to, delim);
      if (s.contentTo > sep.to) builder.add(sep.to, s.contentTo, Decoration.mark({ class: "cm-addition" }));
      builder.add(s.contentTo, s.to, delim);
      continue;
    }
    builder.add(s.from, s.contentFrom, delim);
    if (s.contentTo > s.contentFrom) {
      builder.add(s.contentFrom, s.contentTo, Decoration.mark({ class: CONTENT_CLASS[s.type] }));
    }
    builder.add(s.contentTo, s.to, delim);
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
