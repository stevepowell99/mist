import { useCallback, useEffect, useRef, useState } from "react";
import { SLASH_HELP } from "~/lib/cm-slash";
import { ICON_NAMES } from "~/lib/icons";
import { MOD, deckKeys, type Shortcut } from "~/lib/deck-keys";
import { VIEW_BUTTONS } from "~/components/Toolbar";

/**
 * Keyboard shortcuts and tips, opened by the ? button (bottom-right),
 * Ctrl/Cmd+Alt+/, or ? with the focus in a deck (the deck runtime posts
 * `mist-help`, which opens the Shortcuts tab). Self-contained: owns its open
 * state and its shortcut, so the layout just renders it once.
 *
 * Every row mirrors a real handler, so check this list against them when a key
 * changes: the Ctrl/Cmd+Alt chords in each editor's `runChord` (docs.$id.tsx,
 * PlainEditor.tsx), QuickOpenTrigger (J), CommentInput and PlainEditor's keymap
 * (M), the CodeMirror keymaps in CodeMirrorEditor and PlainEditor (default,
 * search, history, fold, completion, cm-shortcuts), QuickOpen's own keys,
 * PresenterRail (the notes window) and usePresent. The view chords come from
 * VIEW_BUTTONS and the deck keys from the one deck-key table (deck-keys.ts),
 * which the standalone /slides page lists too.
 *
 * On the first ten page loads in a browser it auto-shows, then flies down to the
 * ? button and pulses it, so a first-time viewer learns where help lives.
 *
 * It serves both editors. In the room editor (docs.$id) every line must hold for
 * both kinds of document there or say which it is for: Drive files (sign-in,
 * saved to the file) and shared rooms (secret link only, live editing, text kept
 * in the room). In the local editor (PlainEditor, `editor="local"`) it shows
 * only the Shortcuts and Styling tabs, without the intro, and drops the rows
 * that local files do not have.
 */

/** Which editor a row holds in; a row without `only` holds in both. */
type Editor = "room" | "local";
interface HelpRow extends Shortcut {
  only?: Editor;
}

const LAYOUT: HelpRow[] = [
  { keys: [MOD, "Alt", "S"], label: "Switch between editing and suggesting" },
  ...VIEW_BUTTONS.map((b) => ({ keys: [MOD, "Alt", b.chord], label: b.label })),
  { keys: [MOD, "Alt", "P"], label: "Present: the deck fills the window, notes in a floating window" },
  { keys: [MOD, "Alt", "N"], label: "Present: speaker notes window (notes, next slide, timer)" },
  { keys: [MOD, "Alt", "-"], label: "Shrink the editor pane (split view)", only: "room" },
  { keys: [MOD, "Alt", "="], label: "Grow the editor pane (split view)", only: "room" },
  { keys: [MOD, "P"], label: "Print to PDF" },
];

const PANELS: HelpRow[] = [
  { keys: [MOD, "Alt", "F"], label: "Drive folder sidebar (Drive files)", only: "room" },
  { keys: [MOD, "Alt", "J"], label: "Quick open: search Drive", only: "room" },
  { keys: ["↑", "↓", "Enter"], label: "In Quick open: choose and open (Backspace in an empty box goes up a folder, Esc closes)", only: "room" },
  { keys: [MOD, "click"], label: "In the Drive browser: open a file in a new tab", only: "room" },
  { keys: [MOD, "Alt", "D"], label: "Outline / slide list" },
  { keys: ["drag", "⠿"], label: "Outline: drag a row's grip to move its slide or section, subsections included" },
  { keys: [MOD, "Alt", "C"], label: "Comments panel" },
  { keys: [MOD, "Alt", "G"], label: "Editor to the shown slide (or the divider arrow)", only: "room" },
  { keys: [MOD, "Alt", "/"], label: "This help" },
];

const EDITOR: HelpRow[] = [
  { keys: [MOD, "S"], label: "Save now (Drive files) and rebuild the deck preview", only: "room" },
  { keys: [MOD, "S"], label: "Save now", only: "local" },
  { keys: [MOD, "Enter"], label: "Rebuild the deck preview now", only: "room" },
  { keys: [MOD, "B"], label: "Bold (wrap **)" },
  { keys: [MOD, "I"], label: "Italic (wrap *)" },
  { keys: ["select", "* _ ` = \" ( ["], label: "Wrap the selection in the pair" },
  { keys: [MOD, "Alt", "M"], label: "Comment on the selection, or a point note at the cursor" },
  { keys: [MOD, "click"], label: "Add another cursor" },
  { keys: [MOD, "D"], label: "Select the next occurrence" },
  { keys: [MOD, "Shift", "L"], label: "Select every occurrence" },
  { keys: ["Alt", "drag"], label: "Rectangular (column) select" },
  { keys: [MOD, "F"], label: "Find in the document (F3 next match, Shift+F3 previous)" },
  { keys: [MOD, "Alt", "G"], label: "Go to line", only: "local" },
  { keys: ["@"], label: "Insert a citation (from a .bib)" },
  { keys: ["/"], label: "Slash menu: insert a structure" },
  { keys: ["Ctrl", "Space"], label: "Open the completion menu (slash, class, citation, icon)" },
  { keys: ["Tab"], label: "Indent (Shift+Tab outdents)" },
  { keys: [MOD, "Z"], label: "Undo; with others editing, it undoes only your own edits" },
  { keys: [MOD, "Shift", "Z"], label: "Redo (also Ctrl+Y on Windows)" },
  { keys: ["Ctrl", "Shift", "[ / ]"], label: "Fold / unfold the block (⌘+Alt+[ / ] on a Mac)" },
  { keys: ["Ctrl", "Alt", "[ / ]"], label: "Fold / unfold everything" },
];

// The deck's own keys, from the one table the standalone page also lists.
const DECK: HelpRow[] = deckKeys("editor");

// The speaker notes window (PresenterRail), a window of its own in Present.
const NOTES_WINDOW: HelpRow[] = [
  { keys: ["→", "or", "Space"], label: "Next slide or build step (also ↓, N, Page Down)" },
  { keys: ["←"], label: "Previous slide or build step (also ↑, P, Page Up)" },
  { keys: ["Esc"], label: "Leave Present" },
];

const rowsFor = (rows: HelpRow[], editor: Editor): Shortcut[] =>
  rows.filter((r) => !r.only || r.only === editor);

// Deck/doc settings read from the YAML frontmatter (top-level or nested under
// `format: revealjs:`). Documented in docs/author-grammar.md.
const DECK_SETTINGS: { key: string; val: string }[] = [
  { key: "format:", val: "slides (or slide / revealjs): turns the file into a deck" },
  { key: "theme:", val: "causal-map (default), qualia, brutalist, editorial, blackboard, moonshot, handwritten, minimal" },
  { key: "footer:", val: "text shown on every slide" },
  { key: "slide-number:", val: "true, or a reveal format like c/t" },
  { key: "navigation-mode:", val: "the default is best; grid is 2D but confusing" },
  { key: "css:", val: "a Drive stylesheet, layered last (overrides the theme); Drive files only" },
  { key: "bibliography:", val: "a .bib for @-citations and the reference list; Drive files only" },
  { key: "lang:", val: "spellcheck language, e.g. en-GB (the default)" },
];

// Composable Pandoc class system (the slides app's "style map"): pick a
// component, a colour and optional modifiers. Type `.` inside `{ }` or after a
// `:::` to autocomplete from the deck's own CSS.
const CLASS_GROUPS: { title: string; items: string }[] = [
  { title: "Components", items: ".flare .hl .panel .chip .cards .bignums .columns .callout .lead .footer .rectangle .circle .oval" },
  { title: "Colours (text)", items: ".blue .cyan .teal .green .mint .yellow .orange .pink .mag .navy .grey" },
  { title: "Fill / border", items: ".bg-<colour> (pale; + .solid) sets the background · .border-<colour> draws a border in that colour" },
  { title: "Theme colours", items: ".page .ink .accent .accent-2 (the deck's own palette; also .bg-* and .border-* variants)" },
  { title: "Modifiers", items: ".light .dark .fast .slow .cascade-2…5 .scale-* .width-* .height-* .opacity-* .fade-* .left .center .right .align-top .align-middle .align-bottom" },
  { title: "Callouts", items: "> [!note] / [!tip] / [!warning] / [!important]" },
  { title: "Slide", items: ".place .top-* .left-* .title-page .no-title .caption-bar .brand" },
];

const CLASS_EXAMPLES: { code: string; note: string }[] = [
  { code: "[big idea]{.flare .yellow}", note: "highlight a phrase" },
  { code: "::: {.panel .teal}\n  body\n:::", note: "a tinted panel" },
  { code: "[note]{.teal .bg-pink}", note: "teal text, pink fill" },
  { code: "::: {.circle .border-teal}\n  ok\n:::", note: "teal-outlined shape" },
  { code: "# Section {.center .no-title}", note: "section divider" },
];

// The slash-command list comes straight from the editor (SLASH_HELP imported
// above), so this reference and the live menu cannot drift.

// Sharing & review: the Share menu, who can open, and how comments/suggestions
// work. Mirrors ShareButton, CommentInput (Ctrl/Cmd+Alt+M, or Ctrl/Cmd+Shift+M)
// and SuggestionActions.
const SHARE_MENU: { name: string; desc: string }[] = [
  { name: "Copy edit link", desc: "Full edit access; the holder can also switch to Suggest." },
  { name: "Copy suggest link", desc: "Locked to Suggest: the holder proposes CriticMarkup changes, never edits directly. Someone who opened a suggest link sees a single Copy link." },
  { name: "Links open in preview", desc: "A tick-box (documents only): links copied while it is ticked open in the read-only preview view." },
  { name: "Copy public view link", desc: "Decks: a view-only slide show that needs no sign-in." },
  { name: "Open in Google Drive", desc: "Drive files: the file itself in Drive." },
  { name: "Download", desc: "Save the current text, with its comments, as a .md file. In a shared room this is the only way to keep a copy." },
  { name: "Print to PDF", desc: "A deck's slides or a document's A4 pages as a PDF (also Ctrl/Cmd+P)." },
];

const REVIEW: HelpRow[] = [
  { keys: [MOD, "Alt", "M"], label: "Comment on the selection (or a point note)" },
  { keys: [MOD, "Alt", "S"], label: "Turn Suggest mode on or off, for everyone in the document" },
  { keys: [MOD, "Alt", "C"], label: "Open the comments panel" },
];

// Drive / files behaviour. Mirrors the Drive sidebar, autosave toggle, the
// conflict-safe round-trip (CLAUDE.md 16 June note) and the @-citation picker.
const FILES: { name: string; desc: string }[] = [
  { name: "Open from Drive", desc: "Browse on the home page, Ctrl/Cmd+Alt+J to search, or Ctrl/Cmd+Alt+F for the current folder's sidebar; click a .md or .qmd to open it." },
  { name: "Autosave to Drive", desc: "On by default; edits save on a short pause. The toggle sits at the foot of the comments panel; with it off, Ctrl/Cmd+S or a click on the save badge saves." },
  { name: "Same file elsewhere", desc: "Edit it in Obsidian or Drive too. With no unsaved edits here, gmist loads the newer file; if both changed, your text here is kept and the Drive version is saved beside it as a \"(drive copy)\" file." },
  { name: "Citations", desc: "Type @ to pick a reference from a .bib named in the frontmatter or found in a folder above the file; a reference list renders at the end." },
  { name: "Library", desc: "The header gallery button (or /library) inserts reusable slides and images from the shared library folder. Needs a Google sign-in." },
  { name: "Images", desc: "Paste an image and it is uploaded to Drive and linked in the text." },
];

// The Overview tab: everything gmist does, grouped. A newcomer's first page.
const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "Documents & decks",
    items: [
      "Edit any Markdown file from Google Drive, like Google Docs for .md / .qmd",
      "Add format: revealjs to the frontmatter and the same file is a slide deck",
      "Editor, live preview (formatting shown as you type), split and preview-only views",
    ],
  },
  {
    title: "Writing",
    items: [
      "A / menu inserts structures; a . menu autocompletes the styling classes",
      "@ picks a citation from a .bib, rendered to APA with a reference list",
      "Tables, mermaid diagrams, images, [[wikilinks]] and :name: icons",
    ],
  },
  {
    title: "Review",
    items: [
      "Suggest mode records edits as CriticMarkup; accept or reject them",
      "Threaded comments and highlights, anchored to the text",
    ],
  },
  {
    title: "Slides",
    items: [
      "A composable framework: components, colour / fill / border / theme colours, shade, scale, opacity, placement",
      "Eight themes (causal-map, qualia, brutalist, editorial, blackboard, moonshot, handwritten, minimal)",
      "A shared library of reusable slides and images",
      "Present (Ctrl/Cmd+Alt+P): share the deck window, with notes, next slide and timer in a floating window of their own",
    ],
  },
  {
    title: "Drive files",
    items: [
      "Sign in with Google, then open and browse Drive in a sidebar; edits autosave back to the file, conflict-safe",
      "Share by a secret link with an edit or a suggest role; whoever opens it must also sign in and be shared on the file in Drive, unless the file is shared in Drive with anyone with the link",
      "Citations from a .bib, and the shared slide library",
      "The same file round-trips with Obsidian and a local editor",
    ],
  },
  {
    title: "Shared rooms",
    items: [
      "New blank document, New slide deck, or a .md dropped on the home page makes a room with no Drive file behind it",
      "The secret edit or suggest link is the only key: nobody signs in, and everyone with the link edits live, with cursors and avatars",
      "The text is kept in gmist, not in any file; Download saves a copy as .md",
      "The home page lists the rooms this browser has opened",
    ],
  },
];

const TIPS: { text: string; only?: Editor }[] = [
  { text: "Set theme: causal-map | qualia | brutalist | editorial | blackboard | moonshot | handwritten | minimal in the YAML to restyle the whole deck or doc; ::: {.brand} drops the theme's logo in the corner." },
  { text: "In a Drive file, edits save to Drive automatically, on a short pause after you stop typing.", only: "room" },
  { text: "Edit a Drive file in Obsidian or Drive and gmist loads the newer version when you have no unsaved edits here.", only: "room" },
  { text: "Move the cursor in the editor and the slide preview follows." },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-border/40 px-1.5 py-0.5 font-mono text-sm text-ink shadow-sm">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: Shortcut) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-base text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k, i) =>
          k === "or" ? (
            <span key={i} className="text-sm text-ink/60">
              or
            </span>
          ) : (
            <Kbd key={i}>{k}</Kbd>
          ),
        )}
      </span>
    </div>
  );
}

/** A titled grey panel, so each group of help reads as its own block. */
function Group({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg bg-border/25 p-4 ${className}`}>
      {title && <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink/75">{title}</h3>}
      {children}
    </section>
  );
}

function Section({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <Group title={title}>
      <div className="divide-y divide-border/60">
        {items.map((s) => (
          <Row key={s.label} {...s} />
        ))}
      </div>
    </Group>
  );
}

/** A name + description row, for the Sharing and Files tabs. */
function DefRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2">
      <span className="shrink-0 text-base text-ink">{name}</span>
      <span className="text-right text-sm text-ink/75">{desc}</span>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded px-2.5 py-2 text-base transition-colors ${
        active ? "bg-border/60 font-medium text-ink" : "text-ink/75 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** The intro flies in on the first few page loads, counted in localStorage, and
 *  never again; the Help button and Ctrl/Cmd+Alt+/ are how it opens after that. */
const INTRO_KEY = "mistHelpIntroLoads";
const INTRO_LOADS = 10;

type Tab = "overview" | "shortcuts" | "styling" | "sharing" | "files";

export default function HelpPanel({ editor = "room" }: { editor?: Editor }) {
  const local = editor === "local";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(local ? "shortcuts" : "overview");
  // auto: this is the once-a-session intro (no dark backdrop, flies to the
  // button). flyOut: mid-flight to the corner. pulse: ring the button after.
  const [auto, setAuto] = useState(false);
  const [flyOut, setFlyOut] = useState(false);
  const [pulse, setPulse] = useState(false);
  const introTimers = useRef<number[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Where the focus was before a deliberate open (the editor, or the deck's
  // iframe after ? there), so closing hands it back.
  const returnFocus = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const clearIntro = useCallback(() => {
    introTimers.current.forEach((t) => clearTimeout(t));
    introTimers.current = [];
  }, []);

  // A deliberate open: ends the intro and its timers, so a click or a shortcut
  // never gets yanked away mid-read.
  const show = useCallback(
    (at?: Tab) => {
      clearIntro();
      setAuto(false);
      setFlyOut(false);
      setPulse(false);
      if (at) setTab(at);
      if (!openRef.current) {
        const a = document.activeElement;
        returnFocus.current = a instanceof HTMLElement && a !== document.body ? a : null;
      }
      setOpen(true);
    },
    [clearIntro],
  );

  const dismiss = useCallback(() => {
    clearIntro();
    setAuto(false);
    setFlyOut(false);
    setOpen(false);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, [clearIntro]);

  // Take the focus on a deliberate open, so Esc reaches this window even when
  // ? was pressed in the deck, whose iframe would otherwise keep the keys.
  useEffect(() => {
    if (open && !auto) dialogRef.current?.focus({ preventScroll: true });
  }, [open, auto]);

  // Auto-intro, shown on the first few loads and then not again: long enough to
  // learn the app is there, short enough to stop nagging someone who works in it.
  // Not in the local editor, which runs only on its user's own machine.
  useEffect(() => {
    if (typeof window === "undefined" || local) return;
    let loads = INTRO_LOADS;
    try {
      loads = Number(localStorage.getItem(INTRO_KEY) ?? 0);
      if (!Number.isFinite(loads) || loads < 0) loads = 0;
      localStorage.setItem(INTRO_KEY, String(loads + 1));
    } catch {
      loads = INTRO_LOADS; // no storage: skip rather than nag every load
    }
    if (loads >= INTRO_LOADS) return;
    setAuto(true);
    setOpen(true);
    introTimers.current = [
      window.setTimeout(() => setFlyOut(true), 3200),
      window.setTimeout(() => {
        setOpen(false);
        setFlyOut(false);
        setAuto(false);
        setPulse(true);
      }, 3700),
      window.setTimeout(() => setPulse(false), 6600),
    ];
    return clearIntro;
  }, [clearIntro, local]);

  useEffect(() => {
    // Toggled by the layout's shortcut handler (Ctrl/Cmd+Alt+/, from any focus).
    const toggle = () => {
      if (openRef.current) dismiss();
      else show();
    };
    // ? in the deck: its sandboxed iframe posts this rather than showing
    // reveal's own key list, which is wrong for a gmist deck.
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "mist-help") show("shortcuts");
    };
    // Esc closes this and only this: in capture, and stopped, so it does not
    // also end Present or close whatever is underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener("mist-toggle-help", toggle);
    window.addEventListener("message", onMsg);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mist-toggle-help", toggle);
      window.removeEventListener("message", onMsg);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [show, dismiss]);

  return (
    <>
      <button
        type="button"
        onClick={() => show()}
        title="Shortcuts & tips (Ctrl/Cmd+Alt+/)"
        aria-label="Help"
        className={`fixed bottom-4 right-4 z-40 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-ink text-paper shadow-lg transition-colors hover:bg-chartreuse hover:text-[#1a1a1a] ${pulse ? "mist-help-pulse" : ""}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-[70] flex items-center justify-center p-4 transition-colors duration-500 ${auto ? "bg-transparent" : "bg-black/40"}`}
          onClick={dismiss}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Keyboard shortcuts and tips"
            onClick={(e) => e.stopPropagation()}
            style={{ transformOrigin: "bottom right" }}
            className={`max-h-[80vh] w-full max-w-[60vw] overflow-y-auto rounded-lg border outline-none border-border bg-paper leading-relaxed text-ink shadow-2xl transition-all duration-500 ease-in ${
              flyOut ? "translate-x-[38vw] translate-y-[42vh] scale-[0.15] opacity-0" : "translate-x-0 translate-y-0 scale-100 opacity-100"
            }`}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-1">
                <h2 className="mr-3 font-medium text-ink">Help</h2>
                {!local && (
                  <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
                    Overview
                  </TabButton>
                )}
                <TabButton active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
                  Shortcuts
                </TabButton>
                <TabButton active={tab === "styling"} onClick={() => setTab("styling")}>
                  Styling
                </TabButton>
                {!local && (
                  <>
                    <TabButton active={tab === "sharing"} onClick={() => setTab("sharing")}>
                      Sharing &amp; review
                    </TabButton>
                    <TabButton active={tab === "files"} onClick={() => setTab("files")}>
                      Files
                    </TabButton>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="cursor-pointer px-2 text-xl leading-none text-ink/75 hover:text-ink"
              >
                &times;
              </button>
            </div>

            {tab === "overview" && (
              <div className="grid items-start gap-4 px-5 py-4 sm:grid-cols-2">
                {FEATURES.map((f) => (
                  <Group key={f.title} title={f.title}>
                    <ul className="list-disc space-y-1 pl-4 text-base text-ink/80">
                      {f.items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  </Group>
                ))}
              </div>
            )}
            {tab === "shortcuts" && (
              <div className="grid items-start gap-4 px-5 py-4 sm:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <Section title="View &amp; mode" items={rowsFor(LAYOUT, editor)} />
                  <Section title="Panels" items={rowsFor(PANELS, editor)} />
                  <Section title="Editor" items={rowsFor(EDITOR, editor)} />
                </div>
                <div className="flex flex-col gap-4">
                  <Section title="Deck (focus in the preview or Present)" items={rowsFor(DECK, editor)} />
                  <Section title="Notes window (in Present)" items={rowsFor(NOTES_WINDOW, editor)} />
                  <Group title="Tips">
                    <ul className="list-disc space-y-1 pl-4 text-base text-ink/75">
                      {TIPS.filter((t) => !t.only || t.only === editor).map((t) => (
                        <li key={t.text}>{t.text}</li>
                      ))}
                    </ul>
                  </Group>
                </div>
              </div>
            )}
            {tab === "styling" && (
              <div className="flex flex-col gap-4 px-5 py-4">
                <Group title="Deck &amp; doc settings (YAML)">
                  <p className="mb-3 text-base text-ink/75">
                    Put these at the top of the file, top-level or under{" "}
                    <span className="font-mono text-ink">format: revealjs:</span> (both are read). The slide size is
                    fixed at 1280&times;720, so <span className="font-mono text-ink">width</span>/
                    <span className="font-mono text-ink">height</span> and other Quarto reveal keys are ignored.{" "}
                    <span className="font-mono text-ink">{"::: {.brand}"}</span> drops the theme&apos;s logo in the
                    top-left (Causal Map by default, the QualiaInterviews wordmark for the qualia theme).
                  </p>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    {DECK_SETTINGS.map((s) => (
                      <div key={s.key} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2">
                        <span className="font-mono text-base text-ink">{s.key}</span>
                        <span className="text-right text-sm text-ink/75">{s.val}</span>
                      </div>
                    ))}
                  </div>
                </Group>

                <Group title="Slash commands">
                  <p className="mb-3 text-base text-ink/75">
                    Type <Kbd>/</Kbd> at the start of a line (or after a space) to insert a structure; with text
                    selected, <Kbd>/</Kbd> wraps it. In suggest mode the insert lands as one suggested block.
                  </p>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    {SLASH_HELP.map((s) => (
                      <div key={s.cmd} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2">
                        <span className="font-mono text-base text-ink">{s.cmd}</span>
                        <span className="text-right text-sm text-ink/75">{s.detail}</span>
                      </div>
                    ))}
                  </div>
                </Group>

                <Group title="Slide classes">
                  <p className="mb-3 text-base text-ink/75">
                    Style an element by composing a <span className="text-ink">component</span> + a{" "}
                    <span className="text-ink">colour</span> + optional <span className="text-ink">modifiers</span>. Type{" "}
                    <Kbd>.</Kbd> inside <span className="font-mono text-ink">{"{ }"}</span> or after a{" "}
                    <span className="font-mono text-ink">:::</span> to autocomplete from this deck&apos;s CSS.
                  </p>
                  <div className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      {CLASS_GROUPS.map((g) => (
                        <div key={g.title} className="text-base">
                          <span className="mr-2 inline-block w-24 shrink-0 text-sm uppercase tracking-wider text-ink/75">
                            {g.title}
                          </span>
                          <span className="font-mono text-ink">{g.items}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {CLASS_EXAMPLES.map((e) => (
                        <div key={e.code}>
                          <pre className="overflow-x-auto rounded border border-border bg-paper px-2 py-2 font-mono text-sm text-ink">
                            {e.code}
                          </pre>
                          <span className="text-sm text-ink/75">{e.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Group>

                <Group title="Icons">
                  <p className="mb-2 text-base text-ink/75">
                    Type <span className="font-mono text-ink">:name:</span> for an inline icon, e.g.{" "}
                    <span className="font-mono text-ink">:rocket:</span>. It takes the text colour, so a colour class
                    tints it, and grows with a <span className="font-mono text-ink">.bignums</span> figure.
                  </p>
                  <p className="font-mono text-sm text-ink/75">{ICON_NAMES.map((n) => `:${n}:`).join("  ")}</p>
                </Group>
              </div>
            )}
            {tab === "sharing" && (
              <div className="flex flex-col gap-4 px-5 py-4">
                <Group title="Who can open it">
                  <p className="text-base text-ink/75">
                    <span className="text-ink">Drive files:</span> the secret link is not enough on its own. A reader
                    must be signed in with a Google account the file is shared with in Drive, unless the file is shared
                    in Drive with anyone with the link: then the link opens it without signing in, as an editor if that
                    sharing is Editor and as a suggester if it is Commenter or Viewer. Either way the effective role is
                    the more restrictive of the link and the file&apos;s own sharing.{" "}
                    <span className="text-ink">Shared rooms:</span> the link is the only key, so anyone holding it can
                    open the room without signing in. Nobody needs a gmist account.
                  </p>
                </Group>

                <Group title="Share menu">
                  <p className="mb-3 text-base text-ink/75">
                    From the <span className="text-ink">Share</span> button in the top bar.
                  </p>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    {SHARE_MENU.map((s) => (
                      <DefRow key={s.name} name={s.name} desc={s.desc} />
                    ))}
                  </div>
                </Group>

                <Group title="Comments &amp; suggestions">
                  <p className="mb-3 text-base text-ink/75">
                    Select text and press <Kbd>{MOD}</Kbd> <Kbd>Alt</Kbd> <Kbd>M</Kbd>, or Comment on the selection
                    toolbar, to comment: it wraps the
                    selection as <span className="font-mono text-ink">{"{==text==}{>>note<<}"}</span>, or drops a point
                    note <span className="font-mono text-ink">{"{>>note<<}"}</span> at the cursor. In{" "}
                    <span className="text-ink">Suggest mode</span> your edits become CriticMarkup{" "}
                    (<span className="font-mono text-ink">{"{++added++}"}</span> /{" "}
                    <span className="font-mono text-ink">{"{--deleted--}"}</span>) rather than changing the text
                    directly. An edit-link holder accepts or rejects them, one at a time or all at once, from the
                    comments panel.
                  </p>
                  <div className="divide-y divide-border/60 sm:w-1/2">
                    {REVIEW.map((s) => (
                      <Row key={s.label} {...s} />
                    ))}
                  </div>
                </Group>
              </div>
            )}
            {tab === "files" && (
              <div className="flex flex-col gap-4 px-5 py-4">
                <Group title="Drive files">
                  <p className="mb-3 text-base text-ink/75">
                    A document opened from Drive is a real Markdown file there. It is the same file whether you open it
                    here, in Obsidian or on disk.
                  </p>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    {FILES.map((f) => (
                      <DefRow key={f.name} name={f.name} desc={f.desc} />
                    ))}
                  </div>
                </Group>
                <Group>
                  <p className="text-base text-ink/75">
                    <span className="text-ink">Shared rooms</span> have no file: the text lives in the room, and anyone
                    with the link edits it live. Download (in the Share menu) saves a copy as .md. Drive features (the
                    folder sidebar, autosave, citations, the slide library) do not apply in a room.
                  </p>
                </Group>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
