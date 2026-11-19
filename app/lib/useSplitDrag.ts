import { useCallback, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/**
 * Drag logic for every vertical divider (`SplitGutter`): on mousedown, track the
 * pointer and report the width of the pane left of the divider, measured from
 * the left edge of `contentRef`. In "pct" (the editor/preview split) that is a
 * percentage of the box, clamped 20..100; in "px" (the outline) it is pixels,
 * which the caller clamps. rAF-throttled because each move reflows the
 * iframe-heavy layout, so it coalesces to one resize per frame. `mist-dragging`
 * lets the mouse pass through the preview iframe so the drag never stalls over
 * it. Returns the mousedown handler.
 */
export function useSplitDrag(
  contentRef: RefObject<HTMLDivElement | null>,
  setWidth: (width: number) => void,
  unit: "pct" | "px" = "pct",
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
        if (unit === "px") return setWidth(pendingX - rect.left);
        const pct = ((pendingX - rect.left) / rect.width) * 100;
        setWidth(Math.min(100, Math.max(20, pct)));
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
    [contentRef, setWidth, unit],
  );
}
