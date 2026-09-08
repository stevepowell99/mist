import { useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { listSuggestions, resolveAtCursor } from "~/lib/cm-suggestion-actions";
import { criticSpans } from "~/lib/critic";
import { revealPos } from "~/lib/cm-reveal";

/**
 * The review panel: every suggested edit and every comment in the document.
 *
 * Both are read out of the text itself. A suggestion is `{--old--}{++new++}`, a
 * comment is `{>>note<<}`, and neither has any existence outside the characters
 * on the page. That is the whole point: nothing here is stored anywhere else, so
 * a comment cannot be lost by a tool that does not know about it, cannot be
 * stranded when the sentence it referred to is rewritten by somebody else, and
 * reads perfectly well in VS Code or on GitHub.
 *
 * What it gives up is the thread: no reply chains, no per-comment author or
 * resolved flag. Write the name into the comment if it matters, and delete the
 * comment when it is dealt with. That is a fair trade for a document two people
 * and several agents all write to.
 */
export default function PlainReview({
  view,
  text,
  onClose,
}: {
  view: EditorView | null;
  text: string;
  onClose: () => void;
}) {
  const edits = useMemo(() => listSuggestions(text), [text]);
  const comments = useMemo(
    () =>
      criticSpans(text)
        .filter((s) => s.type === "comment")
        .map((s) => ({ from: s.from, to: s.to, body: text.slice(s.contentFrom, s.contentTo) })),
    [text],
  );

  const jump = (pos: number) => {
    if (!view) return;
    revealPos(view, pos);
    view.focus();
  };

  /** Accept or reject the edit at `from`, by putting the cursor in it first. */
  const resolve = (from: number, accept: boolean) => {
    if (!view) return;
    const change = resolveAtCursor(view.state.doc.toString(), from, accept);
    if (!change) return;
    view.dispatch({
      changes: { from: change.from, to: change.to, insert: change.insert },
      userEvent: accept ? "input.accept" : "input.reject",
    });
  };

  /**
   * A comment is dealt with by deleting it: there is no resolved flag to set.
   *
   * The highlight goes with it. A comment on a selection is written as
   * `{==the words==}{>>the note<<}`, so removing only the note leaves the words
   * wrapped in markup that now marks nothing, which then shows as a stray
   * highlight nobody can explain. Unwrap it: keep the words, drop the braces.
   */
  const drop = (from: number, to: number) => {
    const v = view;
    if (!v) return;
    const doc = v.state.doc.toString();
    const spans = criticSpans(doc);
    const i = spans.findIndex((s) => s.from === from && s.to === to);
    const before = i > 0 ? spans[i - 1] : undefined;
    const abuts =
      before?.type === "highlight" && doc.slice(before.to, from).trim() === "";
    const changes = abuts
      ? [
          { from: before.from, to: before.contentFrom, insert: "" },
          { from: before.contentTo, to, insert: "" },
        ]
      : [{ from, to, insert: "" }];
    v.dispatch({ changes, userEvent: "input.reject" });
  };

  const nothing = edits.length === 0 && comments.length === 0;

  return (
    <div className="flex h-full flex-col overflow-auto border-l border-border text-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-muted">
          Review {nothing ? "" : `(${edits.length + comments.length})`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {nothing && (
        <p className="px-3 py-4 text-xs text-muted">
          No suggestions or comments. Switch the mode to Suggesting and your edits become
          tracked changes; type a comment as {"{>>like this<<}"}.
        </p>
      )}

      {edits.map((e) => (
        <div key={`e${e.from}`} className="border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => jump(e.from)}
            className="block w-full cursor-pointer text-left"
          >
            {e.removed && (
              <span className="block break-words text-xs text-rose-600 line-through">{e.removed}</span>
            )}
            {e.added && (
              <span className="block break-words text-xs text-emerald-700">{e.added}</span>
            )}
            {e.commentText && (
              <span className="mt-1 block break-words text-xs text-muted">{e.commentText}</span>
            )}
          </button>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => resolve(e.from, true)}
              className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => resolve(e.from, false)}
              className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
            >
              Reject
            </button>
          </div>
        </div>
      ))}

      {comments.map((c) => (
        <div key={`c${c.from}`} className="border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => jump(c.from)}
            className="block w-full cursor-pointer break-words text-left text-xs text-ink"
          >
            {c.body}
          </button>
          <button
            type="button"
            onClick={() => drop(c.from, c.to)}
            className="mt-1 cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
