import { useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Header indicator for backend-bound documents (Drive). Saving is live: edits
 * flush to Drive on a short debounce, so this shows "Saving…" while edits are
 * in flight and "Saved" once the relay confirms the write. A click flushes
 * immediately. If the file changed upstream (edited in Obsidian/Drive) the relay
 * refuses to clobber and this shows a Conflict badge and pauses auto-save, so
 * neither side is lost; reconciling the two versions is the cloud-bridge merge
 * (#9), not yet built. Also warns before closing with unsaved edits.
 */
export default function SaveStatus() {
  const { backed, unsaved, conflict, saveNow } = useDocument();

  useEffect(() => {
    if (!unsaved && !conflict) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved, conflict]);

  if (!backed) return null;

  if (conflict) {
    return (
      <span
        className="flex h-full items-center gap-2 bg-amber-500/15 px-3 text-sm uppercase tracking-wider text-amber-600"
        title="This file was also changed in Obsidian/Drive. mist will not overwrite it, and your edits are kept in this session. Auto-save is paused until the two versions are reconciled (auto-merge is not built yet)."
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        Conflict
      </span>
    );
  }

  return (
    <button
      onClick={saveNow}
      className={`flex h-full cursor-pointer items-center gap-2 px-3 text-sm uppercase tracking-wider transition-colors ${
        unsaved ? "text-coral hover:bg-coral/10" : "text-muted hover:bg-border"
      }`}
      title={unsaved ? "Saving to Drive. Click to save now." : "All changes saved"}
      aria-label={unsaved ? "Saving" : "Saved"}
    >
      {unsaved ? (
        <>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-coral" />
          Saving…
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Saved
        </>
      )}
    </button>
  );
}
