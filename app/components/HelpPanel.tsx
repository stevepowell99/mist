import { useEffect, useState } from "react";
import { modAltChord } from "~/lib/chord";

/**
 * Keyboard shortcuts and tips, opened by the ? button (bottom-right) or
 * Ctrl/Cmd+Alt+/. Self-contained: owns its open state and its shortcut, so the
 * layout just renders it once. The listed layout shortcuts mirror the mod+alt
 * handlers in docs.$id.tsx and FolderSidebar; the editor ones come from the
 * CodeMirror keymaps (cm-shortcuts, search, fold).
 */

const MOD = "Ctrl/⌘";

/** One key combo as a row: a label and the keys to press. */
interface Shortcut {
  keys: string[];
  label: string;
}

const LAYOUT: Shortcut[] = [
  { keys: [MOD, "Alt", "E"], label: "Editing mode" },
  { keys: [MOD, "Alt", "S"], label: "Suggesting mode" },
  { keys: [MOD, "Alt", "1"], label: "Editor only" },
  { keys: [MOD, "Alt", "2"], label: "Split editor + preview" },
  { keys: [MOD, "Alt", "3"], label: "Preview only" },
  { keys: [MOD, "Alt", "["], label: "Shrink editor pane" },
  { keys: [MOD, "Alt", "]"], label: "Grow editor pane" },
];

const PANELS: Shortcut[] = [
  { keys: [MOD, "Alt", "F"], label: "Drive / files sidebar" },
  { keys: [MOD, "Alt", "O"], label: "Outline / slide list" },
  { keys: [MOD, "Alt", "C"], label: "Comments panel" },
  { keys: [MOD, "Alt", "/"], label: "This help" },
];

const EDITOR: Shortcut[] = [
  { keys: [MOD, "B"], label: "Bold (wrap **)" },
  { keys: [MOD, "I"], label: "Italic (wrap *)" },
  { keys: ["select", "* _ ` = \" ( ["], label: "Wrap selection in the pair" },
  { keys: ["Alt", "click"], label: "Add another cursor" },
  { keys: [MOD, "D"], label: "Select next occurrence" },
  { keys: ["Alt", "drag"], label: "Rectangular (column) select" },
  { keys: [MOD, "F"], label: "Find in document" },
  { keys: ["@"], label: "Insert citation (if a .bib is found)" },
  { keys: ["Tab"], label: "Indent" },
  { keys: [MOD, "Z"], label: "Undo (collaborative-safe)" },
];

const SLIDES: Shortcut[] = [
  { keys: ["F"], label: "Fullscreen the deck" },
  { keys: ["Esc"], label: "Overview of all slides" },
  { keys: ["S"], label: "Speaker notes" },
  { keys: ["←", "→"], label: "Previous / next slide" },
];

const TIPS = [
  "Edits save to Drive automatically, on a short pause after you stop typing.",
  "Edit the file in Obsidian or Drive and it appears here on reload (Drive wins if both changed).",
  "Set navigation-mode: grid in a deck's YAML for 2D arrow transitions.",
  "Move the cursor in the editor and the slide preview follows.",
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-border/40 px-1.5 py-0.5 font-mono text-xs text-ink shadow-sm">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: Shortcut) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
    </div>
  );
}

function Section({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="divide-y divide-border/60">
        {items.map((s) => (
          <Row key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

export default function HelpPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (modAltChord(e) === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Shortcuts & tips (Ctrl/Cmd+Alt+/)"
        aria-label="Help"
        className="fixed bottom-4 right-4 z-40 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-ink text-paper shadow-lg transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Keyboard shortcuts and tips"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-paper shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-medium text-ink">Keyboard shortcuts &amp; tips</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer px-2 text-xl leading-none text-muted hover:text-ink"
              >
                &times;
              </button>
            </div>
            <div className="grid gap-x-10 gap-y-6 px-5 py-4 sm:grid-cols-2">
              <Section title="View &amp; mode" items={LAYOUT} />
              <Section title="Panels" items={PANELS} />
              <Section title="Editor" items={EDITOR} />
              <div className="flex flex-col gap-6">
                <Section title="Slides preview" items={SLIDES} />
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Tips</h3>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-muted">
                    {TIPS.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
