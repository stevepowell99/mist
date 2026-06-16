import { useEffect, useState } from "react";

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
  { keys: [MOD, "Alt", "S"], label: "Toggle edit / suggest" },
  { keys: [MOD, "Alt", "1"], label: "Editor only" },
  { keys: [MOD, "Alt", "2"], label: "Split editor + preview" },
  { keys: [MOD, "Alt", "3"], label: "Preview only" },
  { keys: [MOD, "Alt", "-"], label: "Shrink editor pane" },
  { keys: [MOD, "Alt", "="], label: "Grow editor pane" },
];

const PANELS: Shortcut[] = [
  { keys: [MOD, "Alt", "F"], label: "Drive / files sidebar" },
  { keys: [MOD, "Alt", "D"], label: "Outline / slide list" },
  { keys: [MOD, "Alt", "C"], label: "Comments panel" },
  { keys: [MOD, "Alt", "G"], label: "Editor to current slide (decks)" },
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
  { keys: ["/"], label: "Slash menu: insert a structure" },
  { keys: ["Tab"], label: "Indent" },
  { keys: [MOD, "Z"], label: "Undo (collaborative-safe)" },
  { keys: [MOD, "Shift", "[ / ]"], label: "Fold / unfold block" },
  { keys: [MOD, "Alt", "[ / ]"], label: "Fold / unfold all" },
];

const SLIDES: Shortcut[] = [
  { keys: [MOD, "S"], label: "Rebuild preview now (or Ctrl/⌘ Enter)" },
  { keys: ["F"], label: "Fullscreen the deck" },
  { keys: ["Esc"], label: "Overview of all slides" },
  { keys: ["S"], label: "Speaker notes" },
  { keys: ["←", "→"], label: "Previous / next slide" },
];

// Composable Pandoc class system (the slides app's "style map"): pick a
// component, a colour and optional modifiers. Type `.` inside `{ }` or after a
// `:::` to autocomplete from the deck's own CSS.
const CLASS_GROUPS: { title: string; items: string }[] = [
  { title: "Components", items: ".flare .hl .panel .bg .chip .card .cards .bignum .columns .column .callout .lead .footer" },
  { title: "Colours", items: ".blue .cyan .teal .green .mint .yellow .pink .mag .navy .grey" },
  { title: "Modifiers", items: ".light .dark .fast .slow .cascade-2…5 .scale-* .left .center .right" },
  { title: "Callouts", items: "> [!note] / [!tip] / [!warning] / [!important]" },
  { title: "Slide", items: ".place .top-* .left-* .title-page .no-title .shot-cap .brand" },
];

const CLASS_EXAMPLES: { code: string; note: string }[] = [
  { code: "[big idea]{.flare .yellow}", note: "highlight a phrase" },
  { code: "::: {.panel .teal}\n  body\n:::", note: "a tinted panel" },
  { code: "# Section {.center .no-title}", note: "section divider" },
];

// Slash-command menu, mirroring cm-slash.ts. Type "/" to insert one of these
// Quarto/Pandoc structures; the class snippets then open the `.`-class picker.
const SLASH: { cmd: string; label: string }[] = [
  { cmd: "/columns", label: "two columns (50/50)" },
  { cmd: "/column", label: "single column block" },
  { cmd: "/columns3", label: "three columns (33%)" },
  { cmd: "/place", label: "float a block (top/left %)" },
  { cmd: "/div", label: "fenced div with a class" },
  { cmd: "/panel", label: "panel box, then pick a colour" },
  { cmd: "/card", label: "one card" },
  { cmd: "/cards", label: "grid of cards (one per item)" },
  { cmd: "/callout", label: "callout box (note/tip/warning)" },
  { cmd: "/bignum", label: "big headline figure + note" },
  { cmd: "/footer", label: "small dimmed footer line" },
  { cmd: "/span", label: "inline [text]{.class}" },
  { cmd: "/highlight", label: "static highlight, pick a colour" },
  { cmd: "/flare", label: "animated highlight, pick a colour" },
  { cmd: "/fragment", label: "reveal one step at a time" },
  { cmd: "/incremental", label: "reveal list items one by one" },
  { cmd: "/notes", label: "speaker notes" },
  { cmd: "/image", label: "insert an image by path" },
  { cmd: "/unwrap", label: "remove the surrounding div" },
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded px-2.5 py-1 text-sm transition-colors ${
        active ? "bg-border/60 font-medium text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function HelpPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"shortcuts" | "styling">("shortcuts");

  useEffect(() => {
    // Toggled by the layout's shortcut handler (Ctrl/Cmd+Alt+/, from any focus).
    const toggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mist-toggle-help", toggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mist-toggle-help", toggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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
              <div className="flex items-center gap-1">
                <h2 className="mr-3 font-medium text-ink">Help</h2>
                <TabButton active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
                  Shortcuts
                </TabButton>
                <TabButton active={tab === "styling"} onClick={() => setTab("styling")}>
                  Styling
                </TabButton>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer px-2 text-xl leading-none text-muted hover:text-ink"
              >
                &times;
              </button>
            </div>

            {tab === "shortcuts" ? (
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
            ) : (
              <div className="px-5 py-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Slash commands</h3>
                <p className="mb-3 text-sm text-muted">
                  Type <Kbd>/</Kbd> at the start of a line (or after a space) to insert a structure; with text
                  selected, <Kbd>/</Kbd> wraps it. In suggest mode the insert lands as one suggested block.
                </p>
                <div className="mb-6 grid gap-x-10 sm:grid-cols-2">
                  {SLASH.map((s) => (
                    <div key={s.cmd} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
                      <span className="font-mono text-sm text-ink">{s.cmd}</span>
                      <span className="text-right text-xs text-muted">{s.label}</span>
                    </div>
                  ))}
                </div>

                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Slide classes</h3>
                <p className="mb-3 text-sm text-muted">
                  Style an element by composing a <span className="text-ink">component</span> + a{" "}
                  <span className="text-ink">colour</span> + optional <span className="text-ink">modifiers</span>. Type{" "}
                  <Kbd>.</Kbd> inside <span className="font-mono text-ink">{"{ }"}</span> or after a{" "}
                  <span className="font-mono text-ink">:::</span> to autocomplete from this deck&apos;s CSS.
                </p>
                <div className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    {CLASS_GROUPS.map((g) => (
                      <div key={g.title} className="text-sm">
                        <span className="mr-2 inline-block w-24 shrink-0 text-xs uppercase tracking-wider text-muted">
                          {g.title}
                        </span>
                        <span className="font-mono text-ink">{g.items}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {CLASS_EXAMPLES.map((e) => (
                      <div key={e.code}>
                        <pre className="overflow-x-auto rounded border border-border bg-border/30 px-2 py-1 font-mono text-xs text-ink">
                          {e.code}
                        </pre>
                        <span className="text-xs text-muted">{e.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
