import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * CriticMarkup rendering for the CodeMirror 6 / Y.Text core (#13). The document
 * holds the raw markdown including literal CriticMarkup delimiters, so unlike
 * the old TipTap mark model there is nothing to reconstruct: we scan the text
 * and decorate the spans. Classes match the existing CSS (`cm-addition`,
 * `cm-deletion`, `cm-comment`, `cm-highlight`, `cm-delimiter`), so the editor,
 * clean view and dark-mode styles all carry over unchanged.
 */

export type CriticType = "addition" | "deletion" | "substitution" | "highlight" | "comment";

export interface CriticSpan {
  type: CriticType;
  /** Start of the opening delimiter. */
  from: number;
  /** End of the closing delimiter. */
  to: number;
  /** Start of the inner content (after the opening delimiter). */
  contentFrom: number;
  /** End of the inner content (before the closing delimiter). For a
   *  substitution this is the end of the replacement (new) text. */
  contentTo: number;
  /** Substitution only: the `~>` separator boundaries. */
  sep?: { from: number; to: number };
}

// One combined matcher, scanned in document order. Non-greedy bodies so
// adjacent spans do not swallow each other.
const SPAN_RE =
  /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;

/** All CriticMarkup spans in `text`, in document order, offset by `base`. */
export function criticSpans(text: string, base = 0): CriticSpan[] {
  const spans: CriticSpan[] = [];
  SPAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_RE.exec(text))) {
    const from = base + m.index;
    const to = from + m[0].length;
    const contentFrom = from + 3;
    if (m[1] !== undefined) {
      spans.push({ type: "addition", from, to, contentFrom, contentTo: to - 3 });
    } else if (m[2] !== undefined) {
      spans.push({ type: "deletion", from, to, contentFrom, contentTo: to - 3 });
    } else if (m[3] !== undefined) {
      // substitution: {~~ old ~> new ~~}
      const sepFrom = contentFrom + m[3].length;
      spans.push({
        type: "substitution",
        from,
        to,
        contentFrom,
        contentTo: to - 3,
        sep: { from: sepFrom, to: sepFrom + 2 },
      });
    } else if (m[5] !== undefined) {
      spans.push({ type: "highlight", from, to, contentFrom, contentTo: to - 3 });
    } else {
      spans.push({ type: "comment", from, to, contentFrom, contentTo: to - 3 });
    }
  }
  return spans;
}

/** The span whose inner content contains `pos` (boundaries inclusive), or null. */
export function spanContentAt(spans: CriticSpan[], pos: number): CriticSpan | null {
  for (const s of spans) {
    if (pos >= s.contentFrom && pos <= s.contentTo) return s;
  }
  return null;
}

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
