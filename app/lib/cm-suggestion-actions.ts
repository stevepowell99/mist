import { criticSpans, type CriticSpan } from "./critic";

/**
 * Accept/reject CriticMarkup suggestions for the CodeMirror 6 / Y.Text core.
 * The TipTap `suggestion-actions.ts` toggled marks; here every action is a text
 * edit on the literal delimiters, which keeps the document the single source of
 * truth. Additions and deletions (and the two halves of a substitution) are the
 * only suggestion types; highlights and comments are left alone.
 */

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

function isSuggestion(s: CriticSpan): boolean {
  return s.type === "addition" || s.type === "deletion" || s.type === "substitution";
}

export function hasSuggestions(text: string): boolean {
  return criticSpans(text).some(isSuggestion);
}

/** The suggestion span at the cursor: one that contains `pos`, or touches it. */
function suggestionAt(text: string, pos: number): CriticSpan | null {
  const spans = criticSpans(text).filter(isSuggestion);
  return spans.find((s) => pos >= s.from && pos <= s.to) ?? null;
}

export function isCursorInSuggestion(text: string, pos: number): boolean {
  return suggestionAt(text, pos) !== null;
}

/** The edit that accepts or rejects a single suggestion span. */
function resolveSpan(text: string, s: CriticSpan, accept: boolean): TextChange {
  const content = text.slice(s.contentFrom, s.contentTo);
  let insert = "";
  if (s.type === "addition") {
    insert = accept ? content : ""; // accept keeps the added text, reject drops it
  } else if (s.type === "deletion") {
    insert = accept ? "" : content; // accept removes the text, reject keeps it
  } else {
    // substitution {~~old~>new~~}: accept keeps new, reject keeps old
    const old = text.slice(s.contentFrom, s.sep!.from);
    const next = text.slice(s.sep!.to, s.contentTo);
    insert = accept ? next : old;
  }
  return { from: s.from, to: s.to, insert };
}

/** One suggestion, for the review list in the panel. `from` is the span start,
 *  so it doubles as the position to scroll the editor to and the `pos` to pass
 *  back to `resolveAtCursor`. */
export interface SuggestionItem {
  type: "addition" | "deletion" | "substitution";
  from: number;
  to: number;
  /** Text being removed (deletion, and the old half of a substitution). */
  removed: string;
  /** Text being added (addition, and the new half of a substitution). */
  added: string;
}

/** Every suggestion in the document, in document order. */
export function listSuggestions(text: string): SuggestionItem[] {
  return criticSpans(text)
    .filter(isSuggestion)
    .map((s) => {
      const content = text.slice(s.contentFrom, s.contentTo);
      const type = s.type as SuggestionItem["type"];
      if (type === "addition") return { type, from: s.from, to: s.to, removed: "", added: content };
      if (type === "deletion") return { type, from: s.from, to: s.to, removed: content, added: "" };
      return {
        type,
        from: s.from,
        to: s.to,
        removed: text.slice(s.contentFrom, s.sep!.from),
        added: text.slice(s.sep!.to, s.contentTo),
      };
    });
}

/** Accept or reject the suggestion at the cursor; null if none there. */
export function resolveAtCursor(text: string, pos: number, accept: boolean): TextChange | null {
  const s = suggestionAt(text, pos);
  return s ? resolveSpan(text, s, accept) : null;
}

/** Accept or reject every suggestion in the document. Changes use original
 *  offsets and are non-overlapping, so they can be applied as one set. */
export function resolveAll(text: string, accept: boolean): TextChange[] {
  return criticSpans(text)
    .filter(isSuggestion)
    .map((s) => resolveSpan(text, s, accept));
}
