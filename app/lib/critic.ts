/**
 * CriticMarkup grammar: the one parser for the five span types, shared by the
 * editor decorations (`cm-criticmarkup`), the comment scanner, the document
 * preview and the deck build. Pure (no CodeMirror import), so the worker can
 * use it too.
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

/** The old (deleted) and new (inserted) halves of a substitution span. */
function subParts(text: string, s: CriticSpan): { old: string; replacement: string } {
  const sep = s.sep!;
  return {
    old: text.slice(s.contentFrom, sep.from),
    replacement: text.slice(sep.to, s.contentTo),
  };
}

/**
 * Rewrite each span, leaving the surrounding text untouched. `render` returns
 * the replacement for a span; the offsets are into `text`. One walk, so the
 * delimiters can never be left behind for markdown to misread (a substitution's
 * `~~` used to reach `marked` and render as strikethrough).
 */
function rewriteSpans(text: string, render: (s: CriticSpan, inner: string) => string): string {
  const spans = criticSpans(text);
  if (!spans.length) return text;
  let out = "";
  let last = 0;
  for (const s of spans) {
    out += text.slice(last, s.from) + render(s, text.slice(s.contentFrom, s.contentTo));
    last = s.to;
  }
  return out + text.slice(last);
}

/** Replace the delimiters with styled spans, for HTML rendering (the preview).
 *  Comments are dropped; a substitution renders old + new, like the editor. */
export function renderCriticHtml(text: string): string {
  return rewriteSpans(text, (s, inner) => {
    switch (s.type) {
      case "addition":
        return `<span class="cm-addition">${inner}</span>`;
      case "deletion":
        return `<span class="cm-deletion">${inner}</span>`;
      case "substitution": {
        const { old, replacement } = subParts(text, s);
        return `<span class="cm-deletion">${old}</span><span class="cm-addition">${replacement}</span>`;
      }
      case "highlight":
        return `<span class="cm-highlight">${inner}</span>`;
      case "comment":
        return "";
    }
  });
}

/** Accept every suggestion and drop every comment, for a clean render (the deck). */
export function stripCritic(text: string): string {
  return rewriteSpans(text, (s, inner) => {
    switch (s.type) {
      case "addition":
      case "highlight":
        return inner;
      case "substitution":
        return subParts(text, s).replacement;
      case "deletion":
      case "comment":
        return "";
    }
  });
}
