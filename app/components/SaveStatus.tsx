import { useEffect, useState, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { SAVE_WINDOW_MS } from "~/shared/constants";

/**
 * Header indicator for backend-bound documents (GitHub or Drive). While edits
 * are unsaved it shows "Unsaved" with a bar that fills over the auto-save
 * window, so the bar reaching the right edge means the save is landing. Clicking
 * saves now and shows instant "Saving…" feedback. Also warns before closing the
 * tab with unsaved edits.
 */
export default function SaveStatus() {
  const { backed, unsaved, saveNow } = useDocument();
  const [saving, setSaving] = useState(false);
  const barRef = useRef<HTMLSpanElement>(null);

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

  // Fill the bar over the commit window, starting when the doc first goes unsaved
  useEffect(() => {
    if (!unsaved) return;
    const el = barRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.width = "0%";
    void el.offsetWidth; // reflow so the next change animates
    el.style.transition = `width ${SAVE_WINDOW_MS}ms linear`;
    el.style.width = "100%";
  }, [unsaved]);

  if (!backed) return null;

  function handleClick() {
    saveNow();
    setSaving(true);
  }

  return (
    <button
      onClick={handleClick}
      className={`relative flex h-full cursor-pointer items-center gap-2 overflow-hidden px-3 text-sm uppercase tracking-wider transition-colors ${
        unsaved ? "text-coral hover:bg-coral/10" : "text-muted hover:bg-border"
      }`}
      title={
        unsaved
          ? "Unsaved changes. Click to save now."
          : "All changes saved"
      }
      aria-label={unsaved ? "Unsaved changes, save now" : "Saved"}
    >
      {unsaved ? (
        <>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-coral" />
          {saving ? "Saving…" : "Unsaved"}
          <span ref={barRef} className="absolute bottom-0 left-0 h-0.5 bg-coral" style={{ width: "0%" }} />
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
