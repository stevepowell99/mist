import { useState } from "react";

/**
 * The box a comment is typed into, floated at the selection.
 *
 * Not `window.prompt`: TagFox opens local gmist in an Electron window, and
 * Electron does not implement prompt(), so it returned nothing and every
 * comment was silently dropped.
 */
export default function CommentBox({
  x,
  y,
  onSave,
  onCancel,
}: {
  x: number;
  y: number;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const width = 320;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const save = () => {
    // One line: a blank line inside `{>>…<<}` would split the paragraph.
    const clean = note.replace(/\s*\n\s*/g, " ").trim();
    if (clean) onSave(clean);
    else onCancel();
  };
  return (
    <div
      className="fixed z-50 rounded border border-border bg-paper p-2 shadow-lg"
      style={{ left, top: y + 6, width }}
    >
      <textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={3}
        placeholder="Comment (Enter to save, Esc to cancel)"
        className="block w-full resize-none rounded border border-border bg-paper p-1.5 text-sm text-ink outline-none"
      />
      <div className="mt-1.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="cursor-pointer text-xs uppercase tracking-wider text-ink"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
