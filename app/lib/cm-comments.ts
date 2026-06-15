import { criticSpans } from "./cm-criticmarkup";
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

export interface CommentChange {
  changes: { from: number; to: number; insert: string }[];
  /** Cursor after applying, placed just inside the comment for a point note. */
  cursor: number;
}

/** Wrap a selection as `{==sel==}{>>note<<}`, or insert a point `{>>note<<}`. */
export function insertCommentChange(
  text: string,
  from: number,
  to: number,
  note: string,
): CommentChange {
  if (from === to) {
    const insert = `{>>${note}<<}`;
    return { changes: [{ from, to, insert }], cursor: from + insert.length };
  }
  const selected = text.slice(from, to);
  const insert = `{==${selected}==}{>>${note}<<}`;
  return { changes: [{ from, to, insert }], cursor: from + insert.length };
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
