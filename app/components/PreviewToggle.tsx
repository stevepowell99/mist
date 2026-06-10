import { useEffect, useCallback } from "react";
import { useDocument } from "~/lib/DocumentContext";

function Spinner() {
  return (
    <svg
      className="mr-1.5 h-3 w-3 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PreviewToggle() {
  const { showPreview, togglePreview, setPreviewHeld: onHold, yjs } = useDocument();
  const synced = yjs.synced;

  // P key hold: peek at preview while held (only when editor not focused)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).closest(".tiptap")) return;
      onHold(true);
    },
    [onHold],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      onHold(false);
    },
    [onHold],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const setView = useCallback(
    (preview: boolean) => {
      if (preview !== showPreview) togglePreview();
    },
    [showPreview, togglePreview],
  );

  const base =
    "flex flex-1 cursor-pointer items-center justify-center gap-1.5 transition-colors";
  const activeCls = "bg-ink text-paper";
  const inactiveCls = "text-muted hover:bg-border";

  return (
    <div className="flex h-12 w-full text-sm uppercase tracking-wider" role="tablist" aria-label="Editor or preview">
      <button
        type="button"
        role="tab"
        aria-selected={!showPreview}
        onClick={() => setView(false)}
        className={`${base} ${!showPreview ? activeCls : inactiveCls}`}
      >
        Editor
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={showPreview}
        onClick={() => setView(true)}
        className={`${base} ${showPreview ? activeCls : inactiveCls}`}
      >
        {!synced && <Spinner />}
        Preview
      </button>
    </div>
  );
}
