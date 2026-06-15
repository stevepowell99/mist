import { useState, useCallback, useEffect, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";

export default function CommentInput() {
  const {
    commentActive: active,
    handleCommentActiveChange: onActiveChange,
    commentSelection: selection,
    insertComment,
  } = useDocument();

  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Cmd+Shift+M
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "m") {
        e.preventDefault();
        onActiveChange(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onActiveChange]);

  // Focus input when becoming active
  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [active]);

  const handleSubmit = useCallback(() => {
    if (!comment.trim()) return;
    // insertComment wraps the captured selection as {==text==}{>>note<<}, or
    // inserts a point {>>note<<} at the cursor, and clears the input state.
    insertComment(comment);
    setComment("");
  }, [comment, insertComment]);

  const handleCancel = useCallback(() => {
    setComment("");
    onActiveChange(false);
  }, [onActiveChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSubmit, handleCancel],
  );

  if (!active) return null;

  return (
    <div className="p-3">
      <label className="mb-1 block text-sm uppercase tracking-wider text-muted">
        Comment
      </label>
      {selection && (
        <div className="mb-1.5 truncate rounded-sm bg-border/50 px-2 py-1 text-sm text-muted">
          {selection.text.length > 60
            ? selection.text.slice(0, 60) + "\u2026"
            : selection.text}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        className="w-full border border-border bg-paper px-2 py-1.5 outline-none focus:border-coral"
      />
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={handleSubmit}
          className="flex-1 cursor-pointer border border-border px-2 py-1 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border"
        >
          Add
        </button>
        <button
          onClick={handleCancel}
          className="flex-1 cursor-pointer border border-border px-2 py-1 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
