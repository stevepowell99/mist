import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

/**
 * Every vertical divider, in both editors (editor/preview, and the outline's
 * right edge): drag it to resize (`useSplitDrag` makes the handler). `children`
 * replaces the grip dots, as the room editor's jump-to-slide button does on a
 * deck; a child that can be pressed must stop its mousedown, or pressing it
 * starts a drag.
 */
export default function SplitGutter({
  onMouseDown,
  title = "Drag to resize editor and preview",
  children,
}: {
  onMouseDown: (e: ReactMouseEvent) => void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      title={title}
      className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-chartreuse"
    >
      {/* widen the grab target a few px into each pane */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
      {children || (
        /* grip dots so the handle is findable */
        <span className="pointer-events-none flex flex-col gap-1 opacity-50 group-hover:opacity-90">
          <span className="h-1 w-1 rounded-full bg-ink" />
          <span className="h-1 w-1 rounded-full bg-ink" />
          <span className="h-1 w-1 rounded-full bg-ink" />
        </span>
      )}
    </div>
  );
}
