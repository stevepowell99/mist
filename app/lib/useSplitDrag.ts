import { useCallback, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/**
 * The draggable split gutter for the editor/preview panes: on mousedown, track
 * the pointer and set the editor pane width as a percentage of the content box
 * (clamped 20..100). rAF-throttled because each move reflows the iframe-heavy
 * layout, so it coalesces to one resize per frame. `mist-dragging` lets the mouse
 * pass through the preview iframe so the drag never stalls over it. Returns the
 * mousedown handler. Extracted from docs.$id.
 */
export function useSplitDrag(
  contentRef: RefObject<HTMLDivElement | null>,
  setEditorPct: (pct: number) => void,
): (e: ReactMouseEvent) => void {
  return useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      let raf = 0;
      let pendingX = 0;
      const apply = () => {
        raf = 0;
        const pct = ((pendingX - rect.left) / rect.width) * 100;
        setEditorPct(Math.min(100, Math.max(20, pct)));
      };
      const onMove = (ev: MouseEvent) => {
        pendingX = ev.clientX;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.classList.remove("mist-dragging");
        if (raf) cancelAnimationFrame(raf);
      };
      document.body.style.userSelect = "none";
      document.body.classList.add("mist-dragging");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [contentRef, setEditorPct],
  );
}
