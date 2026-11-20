import { criticSpans } from "./critic";
import type { DocumentComment } from "./comment-threads";

/**
 * Comment scanning for the CodeMirror 6 / Y.Text core (#13). In the text model
 * a comment is literal `{>>...<<}`, optionally preceded by a highlight
 * `{==...==}` over the commented text. Because the delimiters are real text in
 * the Y.Text CRDT, they move with concurrent edits on their own, so there is no
 * separate anchor to maintain: we just re-scan. Thread metadata (author,
 * replies, resolved) still lives in the Yjs `threads` map and is matched to
 * these spans by `matchThreadsToComments`, exactly as the TipTap path does.
 *
 * `position`/`endPosition` are plain document offsets, which are also
 * CodeMirror positions, so the panel can scroll and select directly.
 */
export function scanTextComments(text: string): DocumentComment[] {
  const spans = criticSpans(text);
  const comments: DocumentComment[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.type !== "comment") continue;
    const prev = spans[i - 1];
    const highlightText =
      prev && prev.type === "highlight" && prev.to === s.from
        ? text.slice(prev.contentFrom, prev.contentTo)
        : undefined;
    comments.push({
      commentText: text.slice(s.contentFrom, s.contentTo),
      highlightText,
      position: s.from,
      endPosition: s.to,
    });
  }
  return comments;
}

/** The range to tint when a thread is active: the highlighted text if the
 *  comment has one, otherwise the comment span itself. Null if not found. */
export function activeRangeFor(
  text: string,
  commentText: string,
  highlightText?: string,
): { from: number; to: number } | null {
  const spans = criticSpans(text);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.type !== "comment") continue;
    if (text.slice(s.contentFrom, s.contentTo) !== commentText) continue;
    const prev = spans[i - 1];
    if (highlightText !== undefined && prev && prev.type === "highlight" && prev.to === s.from) {
      return { from: prev.contentFrom, to: prev.contentTo };
    }
    return { from: s.from, to: s.to };
  }
  return null;
}

/** The comment text at a document position: the cursor is inside the comment
 *  span, or inside its paired highlight. Null if not on a comment. */
export function commentTextAt(text: string, pos: number): string | null {
  const spans = criticSpans(text);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.type !== "comment") continue;
    if (pos >= s.from && pos <= s.to) return text.slice(s.contentFrom, s.contentTo);
    const prev = spans[i - 1];
    if (prev && prev.type === "highlight" && prev.to === s.from && pos >= prev.from && pos <= prev.to) {
      return text.slice(s.contentFrom, s.contentTo);
    }
  }
  return null;
}

export interface CommentChange {
  changes: { from: number; to: number; insert: string }[];
  /** Cursor after applying, placed just inside the comment for a point note. */
  cursor: number;
}

/** The nearest position at or after `pos` that is outside every CriticMarkup
 *  span, and not between a highlight and the comment that annotates it. */
function outsideMarkup(text: string, pos: number): number {
  const spans = criticSpans(text);
  for (let moved = true; moved; ) {
    moved = false;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const inside = pos > s.from && pos < s.to;
      const betweenPair = s.type === "comment" && pos === s.from && spans[i - 1]?.type === "highlight" && spans[i - 1].to === pos;
      if (inside || betweenPair) {
        pos = s.to;
        moved = true;
      }
    }
  }
  return pos;
}

/**
 * Wrap a selection as `{==sel==}{>>note<<}`, or insert a point `{>>note<<}`.
 *
 * Markup never goes inside other markup. The delimiters are hidden in clean
 * view, so a selection can cross a tracked change or another comment without
 * the user seeing it, and wrapping that selection would cut the other span in
 * two and break both. Such a selection gets a point comment after it instead,
 * and a point comment whose position is inside a span moves to the span's end.
 */
export function insertCommentChange(
  text: string,
  from: number,
  to: number,
  note: string,
): CommentChange {
  const crossesMarkup = from < to && criticSpans(text).some((s) => s.from < to && s.to > from);
  if (from === to || crossesMarkup) {
    const at = outsideMarkup(text, to);
    const insert = `{>>${note}<<}`;
    return { changes: [{ from: at, to: at, insert }], cursor: at + insert.length };
  }
  const selected = text.slice(from, to);
  const insert = `{==${selected}==}{>>${note}<<}`;
  return { changes: [{ from, to, insert }], cursor: from + insert.length };
}

/** A line holding nothing but point comments. */
const COMMENT_LINE_RE = /^\s*(?:\{>>[\s\S]*?<<\}\s*)+$/;

/**
 * A point comment on a whole slide (Comment on this slide, over the deck):
 * `{>>note<<}` on a line of its own. It goes straight after the slide's heading
 * line, never on it, so a trailing `{.class}` still ends the heading for Quarto
 * and Obsidian, and below any comment lines already there, so a slide's
 * comments read in the order they were made. A slide without a heading gets it
 * above its first line. A blank line keeps it apart from content that follows,
 * so no renderer reads the two as one block. Markup never goes inside other
 * markup: when the heading is inside a suggestion, the comment goes after the
 * line the suggestion ends on. `slideStart` is the offset of the slide's first
 * line (`offsetForDeckIndex`).
 */
export function slideCommentChange(text: string, slideStart: number, note: string): CommentChange {
  const comment = `{>>${note}<<}`;
  const lineEnd = (p: number) => {
    const i = text.indexOf("\n", p);
    return i < 0 ? text.length : i;
  };
  const lineAfter = (end: number) => (end < text.length ? text.slice(end + 1, lineEnd(end + 1)) : null);
  const start = Math.max(0, Math.min(slideStart, text.length));
  const first = text.slice(start, lineEnd(start));
  if (!/^#{1,6}\s/.test(first) && !COMMENT_LINE_RE.test(first) && outsideMarkup(text, start) === start) {
    const insert = `${comment}\n\n`;
    return { changes: [{ from: start, to: start, insert }], cursor: start + comment.length };
  }
  let at = lineEnd(start);
  for (let next = lineAfter(at); next !== null && COMMENT_LINE_RE.test(next); next = lineAfter(at)) at = lineEnd(at + 1);
  for (let out = outsideMarkup(text, at); out !== at; out = outsideMarkup(text, at)) at = lineEnd(out);
  const next = lineAfter(at);
  const insert = `\n${comment}${next === null || next.trim() === "" ? "" : "\n"}`;
  return { changes: [{ from: at, to: at, insert }], cursor: at + 1 + comment.length };
}

/**
 * The change that deletes the comment at `pos` (inside the comment span or the
 * highlight it annotates), for an editor whose comments live only in the text:
 * there is no thread or resolved flag, so dealing with a comment means deleting
 * it. A highlight just before it, blank gap allowed, is unwrapped rather than
 * left marking nothing. Empty if `pos` is not on a comment.
 */
export function deleteCommentAt(
  text: string,
  pos: number,
): { from: number; to: number; insert: string }[] {
  const spans = criticSpans(text);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.type !== "comment") continue;
    const prev = spans[i - 1];
    const hl =
      prev && prev.type === "highlight" && text.slice(prev.to, s.from).trim() === "" ? prev : null;
    const onIt = (pos >= s.from && pos <= s.to) || (hl !== null && pos >= hl.from && pos <= hl.to);
    if (!onIt) continue;
    return hl
      ? [
          { from: hl.from, to: hl.contentFrom, insert: "" },
          { from: hl.contentTo, to: s.to, insert: "" },
        ]
      : [{ from: s.from, to: s.to, insert: "" }];
  }
  return [];
}

/**
 * The change that removes a comment's inline markup (used on resolve/delete):
 * drop the `{>>...<<}` entirely and, if present, unwrap the preceding
 * `{==...==}` highlight back to its plain text. Returns an empty list if the
 * comment is no longer in the document.
 */
export function removeCommentChange(
  text: string,
  commentText: string,
  highlightText?: string,
): { from: number; to: number; insert: string }[] {
  const spans = criticSpans(text);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.type !== "comment") continue;
    if (text.slice(s.contentFrom, s.contentTo) !== commentText) continue;
    const changes = [{ from: s.from, to: s.to, insert: "" }];
    const prev = spans[i - 1];
    if (
      highlightText !== undefined &&
      prev &&
      prev.type === "highlight" &&
      prev.to === s.from
    ) {
      // unwrap the highlight: replace the whole span with its inner content
      changes.unshift({
        from: prev.from,
        to: prev.to,
        insert: text.slice(prev.contentFrom, prev.contentTo),
      });
    }
    return changes;
  }
  return [];
}
