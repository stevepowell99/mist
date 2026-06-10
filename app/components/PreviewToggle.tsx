import { useState, useEffect, useRef, useCallback } from "react";
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
  const { showPreview: active, togglePreview: onToggle, setPreviewHeld: onHold, yjs } = useDocument();
  const synced = yjs.synced;
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P key hold: show preview while held (only when editor not focused)
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

  // Hover: show preview after 500ms
  function handleMouseEnter() {
    hoverTimer.current = setTimeout(() => {
      setHovering(true);
      onHold(true);
    }, 500);
  }

  function handleMouseLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (hovering) {
      setHovering(false);
      onHold(false);
    }
  }

  return (
    <button
      onClick={onToggle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex h-12 w-full cursor-pointer items-center justify-center text-sm uppercase tracking-wider transition-colors ${
        active
          ? "bg-ink text-paper"
          : "text-muted hover:bg-border"
      }`}
    >
      {!synced && !active && <Spinner />}
      Preview
    </button>
  );
}
