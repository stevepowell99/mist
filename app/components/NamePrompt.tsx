import { useState, useRef, useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Shown on first visit to ask the reader for a name or initials, used for their
 * cursor label and comment authorship. Dismissable; if skipped, a generated
 * name is kept and the prompt does not return.
 */
export default function NamePrompt() {
  const { yjs } = useDocument();
  const { needsName, setUserName, dismissNamePrompt } = yjs;
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (needsName) inputRef.current?.focus();
  }, [needsName]);

  if (!needsName) return null;

  function save() {
    if (value.trim()) setUserName(value.trim());
    else dismissNamePrompt();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm border border-border bg-paper p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-medium">Your name or initials</h2>
        <p className="mb-4 text-sm text-muted">
          Shown on your cursor and against any comments or suggestions you make.
        </p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="e.g. SP or Steve Powell"
          maxLength={40}
          className="mb-4 w-full border border-border bg-transparent px-3 py-2 outline-none focus:border-ink"
          aria-label="Your name or initials"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={dismissNamePrompt}
            className="cursor-pointer px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            Skip
          </button>
          <button
            onClick={save}
            className="cursor-pointer bg-ink px-4 py-1.5 text-sm text-paper transition-opacity hover:opacity-80"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
