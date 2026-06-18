import { useCallback, useEffect, useRef, useState } from "react";
import { SLASH_HELP } from "~/lib/cm-slash";
import { ICON_NAMES } from "~/lib/icons";

/**
 * Keyboard shortcuts and tips, opened by the ? button (bottom-right) or
 * Ctrl/Cmd+Alt+/. Self-contained: owns its open state and its shortcut, so the
 * layout just renders it once. The listed layout shortcuts mirror the mod+alt
 * handlers in docs.$id.tsx and FolderSidebar; the editor ones come from the
 * CodeMirror keymaps (cm-shortcuts, search, fold).
 *
 * Once per browser session it auto-shows on load, then flies down to the ? button
 * and pulses it a few times, so a first-time viewer learns where help lives. The
 * session flag keeps it from re-firing on every doc the owner opens.
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
  { keys: [MOD, "Alt", "P"], label: "Present (deck: fullscreen)" },
  { keys: [MOD, "Alt", "N"], label: "Present: presenter card (next slide, notes, timer)" },
  { keys: [MOD, "Alt", "-"], label: "Shrink editor pane" },
  { keys: [MOD, "Alt", "="], label: "Grow editor pane" },
];

const PANELS: Shortcut[] = [
  { keys: [MOD, "Alt", "F"], label: "Drive / files sidebar" },
  { keys: [MOD, "Alt", "D"], label: "Outline / slide list" },
  { keys: [MOD, "Alt", "C"], label: "Comments panel" },
  { keys: [MOD, "Alt", "G"], label: "Editor to the shown slide (or the divider arrow)" },
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
  { keys: ["Esc"], label: "Exit fullscreen" },
  { keys: ["O"], label: "Overview of all slides" },
  { keys: ["wheel"], label: "Scroll through the overview" },
  { keys: ["S"], label: "Speaker notes" },
  { keys: ["←", "→"], label: "Previous / next slide" },
];

// Deck/doc settings read from the YAML frontmatter (top-level or nested under
// `format: revealjs:`). Documented in docs/author-grammar.md.
const DECK_SETTINGS: { key: string; val: string }[] = [
  { key: "format:", val: "slides (or slide / revealjs): turns the file into a deck" },
  { key: "theme:", val: "causal-map (default), qualia, brutalist, editorial, blackboard, moonshot, handwritten, minimal" },
  { key: "footer:", val: "text shown on every slide" },
  { key: "slide-number:", val: "true, or a reveal format like c/t" },
  { key: "navigation-mode:", val: "the default is best; grid is 2D but confusing" },
  { key: "css:", val: "a Drive stylesheet, layered last (overrides the theme)" },
  { key: "bibliography:", val: "a .bib for @-citations and the reference list" },
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
// work. Mirrors ShareButton, CommentInput (Ctrl/Cmd+Shift+M) and SuggestionActions.
const SHARE_MENU: { name: string; desc: string }[] = [
  { name: "Copy edit link", desc: "Full edit access; the holder can also switch to Suggest." },
  { name: "Copy suggest link", desc: "Locked to Suggest: the holder proposes CriticMarkup changes, never edits directly." },
  { name: "Open link as preview", desc: "Tick first and the link opens in the read-only preview view." },
  { name: "Download", desc: "Save the current text, with its comments, as a .md file." },
  { name: "Print to PDF", desc: "Decks only: opens a print view, then Ctrl/Cmd+P to save as PDF." },
];

const REVIEW: Shortcut[] = [
  { keys: [MOD, "Shift", "M"], label: "Comment on the selection (or a point note)" },
  { keys: [MOD, "Alt", "S"], label: "Turn Suggest mode on or off" },
  { keys: [MOD, "Alt", "C"], label: "Open the comments panel" },
];

// Drive / files behaviour. Mirrors the Drive sidebar, autosave toggle, the
// conflict-safe round-trip (CLAUDE.md 16 June note) and the @-citation picker.
const FILES: { name: string; desc: string }[] = [
  { name: "Open from Drive", desc: "Ctrl/Cmd+Alt+F opens the Drive sidebar; click a .md or .qmd to open it here." },
  { name: "Autosave to Drive", desc: "On by default; edits save on a short pause. Turn it off (right-hand settings) for manual save with Ctrl/Cmd+S." },
  { name: "Same file elsewhere", desc: "Edit it in Obsidian or Drive too; on reload gmist shows the latest (Drive wins if both changed). Avoid editing in two places while Drive for Desktop is syncing." },
  { name: "Citations", desc: "With a bibliography: .bib in the frontmatter, type @ to pick a reference; a reference list renders at the end." },
  { name: "Library", desc: "The header gallery button (or /library) inserts reusable slides and images from the shared library folder." },
];

// The Overview tab: everything gmist does, grouped. A newcomer's first page.
const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "Documents & decks",
    items: [
      "Edit any Markdown file from Google Drive, like Google Docs for .md / .qmd",
      "Add format: revealjs to the frontmatter and the same file is a slide deck",
      "Editor, split (editor + live preview) and preview-only views",
    ],
  },
  {
    title: "Writing",
    items: [
      "A / menu inserts structures; a . menu autocompletes the styling classes",
      "@ picks a citation from a .bib, rendered to APA with a reference list",
      "Tables, math, mermaid, images, and :name: icons",
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
      "One Present mode (Ctrl/Cmd+Alt+P or F): fullscreen, with a presenter card (timer, next slide, notes)",
    ],
  },
  {
    title: "Drive & sharing",
    items: [
      "Open and browse Drive in a sidebar; edits autosave back, conflict-safe",
      "Share by a secret link with an edit or a suggest role; readers sign in to pass the file's Drive sharing",
      "The same file round-trips with Obsidian and a local editor",
    ],
  },
];

const TIPS = [
  "Set theme: causal-map | qualia | brutalist | editorial | blackboard | moonshot | handwritten | minimal in the YAML to restyle the whole deck or doc; ::: {.brand} drops the theme's logo in the corner.",
  "Edits save to Drive automatically, on a short pause after you stop typing.",
  "Edit the file in Obsidian or Drive and it appears here on reload (Drive wins if both changed).",
  "Set navigation-mode: grid in a deck's YAML for 2D arrow transitions.",
  "Move the cursor in the editor and the slide preview follows.",
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
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
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

export default function HelpPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "shortcuts" | "styling" | "sharing" | "files">("overview");
  // auto: this is the once-a-session intro (no dark backdrop, flies to the
  // button). flyOut: mid-flight to the corner. pulse: ring the button after.
  const [auto, setAuto] = useState(false);
  const [flyOut, setFlyOut] = useState(false);
  const [pulse, setPulse] = useState(false);
  const introTimers = useRef<number[]>([]);

  const clearIntro = useCallback(() => {
    introTimers.current.forEach((t) => clearTimeout(t));
    introTimers.current = [];
  }, []);

  // Any deliberate open/close ends the intro and its timers, so a click or a
  // shortcut never gets yanked away mid-read.
  const dismiss = useCallback(() => {
    clearIntro();
    setAuto(false);
    setFlyOut(false);
    setOpen(false);
  }, [clearIntro]);

  // Auto-intro, gated to once per browser session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let shown = true;
    try {
      shown = sessionStorage.getItem("mistHelpIntroShown") === "1";
      sessionStorage.setItem("mistHelpIntroShown", "1");
    } catch {
      shown = true; // no storage: skip rather than nag every load
    }
    if (shown) return;
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
  }, [clearIntro]);

  useEffect(() => {
    // Toggled by the layout's shortcut handler (Ctrl/Cmd+Alt+/, from any focus).
    const toggle = () => {
      clearIntro();
      setAuto(false);
      setFlyOut(false);
      setPulse(false);
      setOpen((v) => !v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("mist-toggle-help", toggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mist-toggle-help", toggle);
      window.removeEventListener("keydown", onKey);
    };
  }, [clearIntro, dismiss]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          clearIntro();
          setAuto(false);
          setFlyOut(false);
          setPulse(false);
          setOpen(true);
        }}
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
            role="dialog"
            aria-label="Keyboard shortcuts and tips"
            onClick={(e) => e.stopPropagation()}
            style={{ transformOrigin: "bottom right" }}
            className={`max-h-[80vh] w-full max-w-[60vw] overflow-y-auto rounded-lg border border-border bg-paper leading-relaxed text-ink shadow-2xl transition-all duration-500 ease-in ${
              flyOut ? "translate-x-[38vw] translate-y-[42vh] scale-[0.15] opacity-0" : "translate-x-0 translate-y-0 scale-100 opacity-100"
            }`}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-1">
                <h2 className="mr-3 font-medium text-ink">Help</h2>
                <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
                  Overview
                </TabButton>
                <TabButton active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
                  Shortcuts
                </TabButton>
                <TabButton active={tab === "styling"} onClick={() => setTab("styling")}>
                  Styling
                </TabButton>
                <TabButton active={tab === "sharing"} onClick={() => setTab("sharing")}>
                  Sharing &amp; review
                </TabButton>
                <TabButton active={tab === "files"} onClick={() => setTab("files")}>
                  Files
                </TabButton>
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
                <Section title="View &amp; mode" items={LAYOUT} />
                <Section title="Panels" items={PANELS} />
                <Section title="Editor" items={EDITOR} />
                <div className="flex flex-col gap-4">
                  <Section title="Slides preview" items={SLIDES} />
                  <Group title="Tips">
                    <ul className="list-disc space-y-1 pl-4 text-base text-ink/75">
                      {TIPS.map((t) => (
                        <li key={t}>{t}</li>
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
                    The secret link is not enough on its own: a reader must be signed in with a Google account the file
                    is shared with in Drive. Drive sharing is the source of truth, and the effective role is the more
                    restrictive of the link and the file&apos;s own sharing. Collaborators need no gmist account.
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
                    Select text and press <Kbd>{MOD}</Kbd> <Kbd>Shift</Kbd> <Kbd>M</Kbd> to comment: it wraps the
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
                    Every gmist document is a real Markdown file in Google Drive. It is the same file whether you open
                    it here, in Obsidian or on disk.
                  </p>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    {FILES.map((f) => (
                      <DefRow key={f.name} name={f.name} desc={f.desc} />
                    ))}
                  </div>
                </Group>
                <Group>
                  <p className="text-base text-ink/75">
                    Live editing by several people at once is not a goal; gmist is for one writer at a time plus async
                    review. See the Sharing &amp; review tab for comments and suggestions.
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
