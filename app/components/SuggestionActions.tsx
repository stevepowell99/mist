import { useCallback, useMemo } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestions, resolveAtCursor, resolveAll } from "~/lib/cm-suggestion-actions";

export default function SuggestionActions() {
  const { view, markdown, mode, role } = useDocument();
  const suggestionsPresent = useMemo(() => hasSuggestions(markdown), [markdown]);

  const atCursor = useCallback(
    (accept: boolean) => {
      if (!view) return;
      const change = resolveAtCursor(view.state.doc.toString(), view.state.selection.main.head, accept);
      if (change) view.dispatch({ changes: change, userEvent: "input.accept" });
      view.focus();
    },
    [view],
  );

  const all = useCallback(
    (accept: boolean) => {
      if (!view) return;
      const changes = resolveAll(view.state.doc.toString(), accept);
      if (changes.length) view.dispatch({ changes, userEvent: "input.accept" });
      view.focus();
    },
    [view],
  );

  const isSuggest = mode === "suggest";
  // Accepting or rejecting applies edits, so only edit-link users see these
  if (role !== "edit") return null;
  // In edit mode, hide when no suggestions. In suggest mode, always show.
  if (!isSuggest && !suggestionsPresent) return null;

  const enabledClass =
    "flex-1 cursor-pointer border border-border px-2 py-1.5 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border";
  const disabledClass =
    "flex-1 cursor-default border border-border px-2 py-1.5 text-sm uppercase tracking-wider text-muted/40 transition-colors";

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex gap-1">
        <button onClick={() => atCursor(true)} disabled={!suggestionsPresent} className={suggestionsPresent ? enabledClass : disabledClass}>
          Accept
        </button>
        <button onClick={() => atCursor(false)} disabled={!suggestionsPresent} className={suggestionsPresent ? enabledClass : disabledClass}>
          Reject
        </button>
      </div>
      <div className="flex gap-1">
        <button onClick={() => all(true)} disabled={!suggestionsPresent} className={suggestionsPresent ? enabledClass : disabledClass}>
          Accept all
        </button>
        <button onClick={() => all(false)} disabled={!suggestionsPresent} className={suggestionsPresent ? enabledClass : disabledClass}>
          Reject all
        </button>
      </div>
    </div>
  );
}
