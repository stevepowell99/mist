import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

/**
 * Header indicator for backend-bound documents (Drive). Saving is explicit only
 * (no auto-save), so while there are unsaved edits it shows "Unsaved" and a
 * click saves now with instant "Saving…" feedback. Also warns before closing the
 * tab with unsaved edits.
 */
export default function SaveStatus() {
  const { backed, unsaved, saveNow } = useDocument();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // Clear the click feedback once the commit is confirmed (unsaved -> false)
  useEffect(() => {
    if (!unsaved) setSaving(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [unsaved]);

  if (!backed) return null;

  function handleClick() {
    saveNow();
    setSaving(true);
  }

  return (
    <button
      onClick={handleClick}
      className={`flex h-full cursor-pointer items-center gap-2 px-3 text-sm uppercase tracking-wider transition-colors ${
        unsaved ? "text-coral hover:bg-coral/10" : "text-muted hover:bg-border"
      }`}
      title={unsaved ? "Unsaved changes. Click to save to Drive." : "All changes saved"}
      aria-label={unsaved ? "Unsaved changes, save now" : "Saved"}
    >
      {unsaved ? (
        <>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-coral" />
          {saving ? "Saving…" : "Save"}
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
