import { useEffect, useCallback } from "react";
import { useDocument } from "~/lib/DocumentContext";
import PairToggle from "~/components/PairToggle";

export default function PreviewToggle() {
  const { showPreview, togglePreview, setPreviewHeld: onHold } = useDocument();

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

  return (
    <PairToggle
      left="Editor"
      right="Preview"
      leftFill="bg-signal-red"
      rightFill="bg-signal-green"
      leftText="text-signal-red"
      rightText="text-signal-green"
      isRight={showPreview}
      onChange={(preview) => {
        if (preview !== showPreview) togglePreview();
      }}
    />
  );
}
