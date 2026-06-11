import { useEffect, useCallback } from "react";
import { useDocument } from "~/lib/DocumentContext";

type View = "edit" | "suggest" | "preview";

// A single three-position control. Edit and Suggest both show the editor (the
// difference is whether changes are tracked); Preview shows the rendered, read-
// only document. Colours run as a traffic light: edit red, suggest orange,
// preview green. Suggest-link users can't edit directly, so they only see
// Suggest and Preview.
const SEGMENTS: { id: View; label: string; on: string; off: string }[] = [
  { id: "edit", label: "Edit", on: "bg-signal-red text-paper", off: "text-signal-red" },
  { id: "suggest", label: "Suggest", on: "bg-signal-orange text-paper", off: "text-signal-orange" },
  { id: "preview", label: "Preview", on: "bg-signal-green text-paper", off: "text-signal-green" },
];

export default function ViewToggle() {
  const { mode, showPreview, role, setPreview, toggleMode, setPreviewHeld } = useDocument();

  const current: View = showPreview ? "preview" : mode;

  const select = useCallback(
    (v: View) => {
      if (v === "preview") {
        setPreview(true);
        return;
      }
      setPreview(false);
      // Only two editor modes, so a single toggle reaches the wanted one.
      // toggleMode itself is a no-op for suggest-link users.
      if (mode !== v) toggleMode();
    },
    [setPreview, mode, toggleMode],
  );

  // Hold P to peek at Preview while the editor isn't focused.
  useEffect(() => {
    const focused = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const tag = el?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || !!el?.closest(".tiptap");
    };
    const down = (e: KeyboardEvent) => {
      if ((e.key === "p" || e.key === "P") && !e.repeat && !focused(e.target)) setPreviewHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") setPreviewHeld(false);
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, [setPreviewHeld]);

  const segments = role === "edit" ? SEGMENTS : SEGMENTS.filter((s) => s.id !== "edit");

  return (
    <div className="flex h-12 items-center justify-center px-4">
      <div className="inline-flex overflow-hidden rounded-full border border-border" role="group" aria-label="View mode">
        {segments.map((s, i) => {
          const active = current === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => select(s.id)}
              className={`cursor-pointer px-4 py-1.5 text-sm uppercase tracking-wider transition-colors ${
                i > 0 ? "border-l border-border" : ""
              } ${active ? `${s.on} font-semibold` : `${s.off} hover:opacity-70`}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
