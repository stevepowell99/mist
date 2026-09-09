import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { mistFolds } from "~/lib/cm-folding";
import { wrapKeymap } from "~/lib/cm-shortcuts";
import { criticMarkup } from "~/lib/cm-criticmarkup";
import { fencedDivStyle } from "~/lib/cm-fenced-divs";
import { citationSource } from "~/lib/cm-citations";
import { slashSource } from "~/lib/cm-slash";
import { iconSource } from "~/lib/cm-icons";
import { classSource } from "~/lib/cm-classes";
import { parseCssClasses } from "~/lib/cm-classes";
import DECK_BASE_CSS from "~/styles/deck-base.css?raw";
import { suggestMode } from "~/lib/cm-suggest";
import { selectionToolbar } from "~/lib/cm-selection-toolbar";
import { insertCommentChange } from "~/lib/cm-comments";
import { wrapOnSelection } from "~/lib/cm-shortcuts";
import PlainReview from "~/components/PlainReview";
import { markdownLineStyle } from "~/lib/cm-markdown-style";
import PlainPreview from "~/components/PlainPreview";
import SlidesView, { isSlideDeck } from "~/components/SlidesView";
import { slideIndexForOffset } from "~/lib/slide-cursor";
import PresenterRail from "~/components/PresenterRail";
import CommitButton from "~/components/CommitButton";
import OutlinePanel from "~/components/OutlinePanel";
import { livePreview } from "~/lib/cm-live-preview";
import { resolveAssetSrc, type AssetCtx } from "~/lib/asset-urls";
import { parseBib, type BibLibrary } from "~/lib/citations";
import { extractBibPaths } from "~/lib/slides-build";
import { useFileSync, type FileSyncBuffer } from "~/lib/useFileSync";
import { rawFrontmatter } from "~/lib/thread-serialization";
import type { DriveMeta } from "~/shared/types";

/**
 * A local file, edited.
 *
 * There is no document here that the editor owns. There is a file, and a buffer
 * in this tab that is a view of it. Everything below follows from that, and it
 * is the whole of the design:
 *
 *  - Save about a second after the typing stops. Saving quickly is what makes
 *    live updating work: the buffer is clean almost all the time, so a change
 *    arriving from elsewhere can be taken silently, with nothing local to weigh
 *    it against. A long interval keeps the buffer dirty and turns every outside
 *    edit into a question.
 *  - Write back the bytes that were read, changed only where the user typed.
 *    Nothing is normalised on the way to disk.
 *  - Poll the file. Clean buffer, take the new version and keep the cursor.
 *    Dirty buffer, say so and let the user choose.
 *  - Never resolve a real clash. Refuse the write, keep a copy, ask.
 */
/**
 * The live layer: the decorations that hide the marks, and the class that
 * typesets what is left.
 *
 * All three, always, together. The decorations alone hide nothing visible and
 * read as plain source; the typography alone leaves every hash and asterisk in
 * place. Each was shipped on its own before this comment existed. The typography lives in `.live-preview` in app.css, and per the
 * repo's own invariant a view-wide class has to ride in `editorAttributes`,
 * never on the DOM node, because CodeMirror rewrites that attribute whenever it
 * takes focus.
 *
 * `resolveSrc` must not throw. A decoration plugin that throws is dropped by
 * CodeMirror without a word, and dropping this one brings back every `#` and
 * `**` in the document at once. It was passed a null context here, which threw
 * on any relative image path and left absolute ones working, so the whole live
 * layer collapsed on some documents and not others.
 */
function liveLayer(resolveSrc: (src: string) => string, getBib: () => BibLibrary | null) {
  return [
    livePreview({ resolveSrc, getBib }),
    // Both classes, because they do different halves of the job: live-preview
    // sets the typography, clean-view hides the delimiters. Only the first is
    // what shipped, which gave headings at heading size with their hashes still
    // in front of them.
    EditorView.editorAttributes.of({ class: "live-preview clean-view" }),
  ];
}

type Status = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error";

type View = "live" | "editor" | "split" | "preview";

/**
 * The view and the contents panel are how this person likes to work, not
 * anything about the document, so they are remembered per browser rather than
 * written into the file. Reading happens after mount: the server renders the
 * default, and a value read during render would not match it.
 */
const VIEW_KEY = "gmist.plain.view";
const REVIEW_KEY = "gmist.plain.review";
const MODE_KEY = "gmist.plain.mode";

/** The class names the deck stylesheet defines, for the `.`-picker. */
const CSS_CLASSES = parseCssClasses(DECK_BASE_CSS);
const OUTLINE_KEY = "gmist.plain.outline";

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    // a private window, or storage refused: the default is fine
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // nothing here is worth failing an edit for
  }
}

export default function PlainEditor({
  fileId,
  name,
  folderId,
}: {
  fileId: string;
  name: string;
  folderId?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /** The file's content, from the moment it is read until the editor exists to
   *  hold it. The sync layer reads the file before there is anywhere to put it,
   *  because the editor is built around what it finds. */
  const initial = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  /** The file has moved under us and the buffer is frozen. Read by the toolbar
   *  and the comment action, which must not re-subscribe when it changes. */
  const conflicted = useRef(false);
  /** Holds the editable flag, so a conflict can freeze the buffer in place. */
  const editable = useRef(new Compartment());
  const [note, setNote] = useState<string | null>(null);
  // Live is the default for prose: the document typeset in place, which is what
  // you want when writing. The three-pane arrangement earns its keep for a deck,
  // where the slide and its source are different things.
  const [layout, setLayout] = useState<View>("live");
  /** The same value, readable at the moment the editor is built. The editor is
   *  created after a fetch, so the remembered view has long since been restored
   *  by then, but the creation effect cannot see the state it landed in. */
  const layoutRef = useRef<View>("live");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** Suggesting turns every edit into CriticMarkup instead of applying it. It is
   *  a mode of typing, not of storage: the marks are characters in the file. */
  const [mode, setMode] = useState<"edit" | "suggest">("edit");
  const modeRef = useRef<"edit" | "suggest">("edit");
  /** So the outline can move the cursor and the live layer can be reconfigured. */
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  /** The document text, mirrored into React so the preview can render it. The
   *  editor remains the owner; this is a copy for display, never a second
   *  source of truth. */
  const [text, setText] = useState("");
  /** Where the cursor is, so a deck can show the slide being written. */
  const [cursorOffset, setCursorOffset] = useState(0);
  /** Fullscreen, chrome hidden, the deck filling the screen. */
  const [presenting, setPresenting] = useState(false);
  /** The presenter card, and when the talk started, for its clock. */
  const [railOpen, setRailOpen] = useState(false);
  const [presentStart, setPresentStart] = useState(0);
  const [bibLib, setBibLib] = useState<BibLibrary | null>(null);
  /** Spellcheck language, from a `lang:` in the frontmatter. British by default,
   *  which is the house style. */
  const langRef = useRef("en-GB");
  const bibRef = useRef<BibLibrary | null>(null);
  /** Live typesetting, on or off, without rebuilding the editor. */
  const liveOn = useRef(new Compartment());

  /**
   * An image's src, as a URL the browser can fetch.
   *
   * Read through a ref at decoration time, the way the Drive editor does, so a
   * change of folder does not rebuild the editor. It is the same context the
   * preview beside it uses, so the two agree on every image.
   */
  const assetCtx = useRef<AssetCtx>({ drive: null, origin: "", driveToken: "" });
  useEffect(() => {
    assetCtx.current = {
      drive: folderId ? ({ fileId, name, folderId } as DriveMeta) : null,
      origin: typeof window === "undefined" ? "" : window.location.origin,
      driveToken: "",
    };
  }, [fileId, name, folderId]);
  const resolveSrc = useCallback((src: string) => resolveAssetSrc(src, assetCtx.current), []);

  // Citations. The document names its library in `bibliography:`; the route
  // resolves it, including an absolute or ~ path, which is the only way to reach
  // a library that is not an ancestor of the file.
  const frontmatter = useMemo(() => rawFrontmatter(text), [text]);
  useEffect(() => {
    const m = /^\s*lang(?:uage)?:\s*(.+)$/m.exec(frontmatter);
    langRef.current = m ? m[1].trim().replace(/^["']|["']$/g, "") : "en-GB";
  }, [frontmatter]);

  const bibPaths = useMemo(() => extractBibPaths(frontmatter).join("|"), [frontmatter]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      if (!folderId || !bibPaths) {
        setBibLib(null);
        return;
      }
      const q = new URLSearchParams({ folder: folderId });
      for (const path of bibPaths.split("|")) q.append("path", path);
      try {
        const res = await fetch(`/drive/bib?${q}`);
        if (!res.ok || stopped) return;
        const raw = await res.text();
        if (!stopped) setBibLib(raw.trim() ? parseBib(raw) : null);
      } catch {
        // no library is a normal state, not an error
      }
    })();
    return () => {
      stopped = true;
    };
  }, [folderId, bibPaths]);

  // The live layer reads the library through a ref, so a new one does not rebuild
  // the editor; keeping it current is an effect rather than a render-time write.
  useEffect(() => {
    bibRef.current = bibLib;
  }, [bibLib]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /**
   * The toolbar's Comment button, and Ctrl/Cmd+Alt+M.
   *
   * A comment is `{>>note<<}` written into the document, wrapping the selection
   * in `{==…==}` when there is one, so the note is anchored by the words it is
   * about rather than by an offset that the next edit invalidates.
   */
  useEffect(() => {
    const onComment = () => {
      const v = view.current;
      if (!v || conflicted.current) return;
      const note = window.prompt("Comment");
      if (!note) return;
      const { from, to } = v.state.selection.main;
      const { changes, cursor } = insertCommentChange(v.state.doc.toString(), from, to, note);
      v.dispatch({ changes, selection: { anchor: cursor }, userEvent: "input.comment" });
      v.focus();
    };
    window.addEventListener("mist-comment", onComment);
    return () => window.removeEventListener("mist-comment", onComment);
  }, []);

  // Restore the remembered view and panel once, on the client. The server has
  // no localStorage, so this is a deliberate post-mount correction rather than
  // state that could have been initialised.
  useEffect(() => {
    const view = remembered(VIEW_KEY, ["live", "editor", "split", "preview"] as const, "live");
    layoutRef.current = view;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server has no localStorage, so it rendered the default; this is a correction after mount, not state that could have been initialised.
    setLayout(view);
    setOutlineOpen(remembered(OUTLINE_KEY, ["yes", "no"] as const, "no") === "yes");
    setReviewOpen(remembered(REVIEW_KEY, ["yes", "no"] as const, "no") === "yes");
    setMode(remembered(MODE_KEY, ["edit", "suggest"] as const, "edit"));
  }, []);

  useEffect(() => {
    layoutRef.current = layout;
    view.current?.dispatch({
      effects: liveOn.current.reconfigure(
        layout === "live" ? liveLayer(resolveSrc, () => bibRef.current) : [],
      ),
    });
  }, [layout, resolveSrc]);

  /** Replace only the span that differs, so the cursor and the scroll position
   *  survive an outside edit that did not touch the line being worked on. */
  const adopt = useCallback((text: string) => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === text) return;
    let head = 0;
    const max = Math.min(current.length, text.length);
    while (head < max && current[head] === text[head]) head++;
    let tail = 0;
    while (tail < max - head && current[current.length - 1 - tail] === text[text.length - 1 - tail]) {
      tail++;
    }
    v.dispatch({
      changes: {
        from: head,
        to: current.length - tail,
        insert: text.slice(head, text.length - tail),
      },
      // Not a user edit, so it must not mark the buffer dirty or start a save.
      annotations: Transaction.remote.of(true),
    });
    setText(text);
  }, []);

  /**
   * A CodeMirror document, in the terms the sync layer asks for.
   *
   * The simpler of the two buffers: what is on screen is the file, so nothing is
   * normalised on the way in or out. The one wrinkle is that the file is read
   * before the editor exists, because the editor is built around what it finds,
   * so the first content waits in a ref until there is a view to put it in.
   */
  const buffer = useMemo<FileSyncBuffer>(
    () => ({
      normalise: (text) => text,
      held: () => view.current?.state.doc.toString() ?? initial.current,
      put(text, first) {
        if (first || !view.current) initial.current = text;
        else adopt(text);
      },
      serialise: () => view.current?.state.doc.toString() ?? null,
    }),
    [adopt],
  );

  const raiseConflictRef = useRef<(why: string) => void>(() => {});
  /** The typing signal and the explicit save, read at edit time so a new
   *  callback identity does not tear down and rebuild the editor. */
  const touchedRef = useRef<() => void>(() => {});
  const saveNowRef = useRef<() => void>(() => {});

  const sync = useFileSync(fileId, buffer, {
    onAdopted: (text) => {
      setText(text);
      setStatus("clean");
    },
    onOffered: (why) =>
      raiseConflictRef.current(
        why === "dirty"
          ? "The file changed on disk while you were typing."
          : why === "reverted"
            ? "Something put the file back to a version you have already seen."
            : "Something rewrote the file on disk and it is shorter than what you have.",
      ),
    onConflict: () => raiseConflictRef.current("The file changed on disk while you were typing."),
    onSaved: () => {
      setStatus("clean");
      setNote(null);
    },
    onError: (message) => {
      setStatus("error");
      setNote(message);
    },
  });

  /** Another window has this file, so this one reads nothing and writes nothing. */
  const alreadyOpen = sync.alreadyOpen;

  /** A deck is the same document with a different preview: the source is
   *  markdown either way, and the editor does not change. */
  const deck = useMemo(() => isSlideDeck(text), [text]);
  const slideProps = {
    markdown: text,
    drive: folderId ? ({ fileId, name, folderId } as DriveMeta) : null,
    frontmatter,
    cursorOffset,
    followCursor: true,
    bibLib,
  };

  /**
   * Present: fullscreen the whole app, not the deck's iframe.
   *
   * Fullscreening the iframe hides everything the app draws beside the slide,
   * including the presenter card, which is why this takes the document element.
   * Leaving fullscreen by any route leaves Present, through the listener below.
   */
  const enterPresent = useCallback(() => {
    if (!deck) return;
    setPresentStart(Date.now());
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, [deck]);

  const exitPresent = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  const presentingRef = useRef(presenting);
  useEffect(() => {
    presentingRef.current = presenting;
  }, [presenting]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && presentingRef.current) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // The deck runtime intercepts plain F inside its iframe and posts this, so
  // reveal's own fullscreen never fires and the presenter card stays visible.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === "mist-present" || e.data?.type === "mist-present") enterPresent();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enterPresent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
      if (e.key.toLowerCase() !== "p" || !deck) return;
      e.preventDefault();
      if (presentingRef.current) exitPresent();
      else enterPresent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, enterPresent, exitPresent]);

  /**
   * The file moved under us, and taking the change would lose something.
   *
   * Stop saving, because every attempt would be refused and retrying only hides
   * the real problem. That leaves the buffer as the only copy of what is here,
   * which is exactly the state a crashed tab loses, so write it beside the
   * document straight away. The user then chooses, with nothing at risk either
   * way.
   */
  const raiseConflict = useCallback(
    async (why: string) => {
      if (conflicted.current) return;
      conflicted.current = true;
      sync.halt();
      setStatus("conflict");
      setNote(why);
      // Freeze the buffer. Carrying on typing into something that cannot be
      // saved only builds up work that will have to be merged by hand later, and
      // the copy written below means nothing typed so far is at risk.
      view.current?.dispatch({
        effects: editable.current.reconfigure(EditorView.editable.of(false)),
      });
      const saved = await sync.saveRecovery();
      if (saved) setNote(`${why} Your version is safe in "${saved}".`);
    },
    [sync],
  );

  useEffect(() => {
    raiseConflictRef.current = (why: string) => void raiseConflict(why);
    touchedRef.current = sync.touched;
    saveNowRef.current = () => sync.save();
  });


  // Build the editor once the file has been read, around what it found. The
  // reading, the polling and the saving are all the sync layer's; this effect
  // owns the view and nothing else.
  useEffect(() => {
    if (!sync.ready || view.current || !host.current || initial.current === null) return;
    const first = initial.current;
    {
      {
        const state = EditorState.create({
          doc: first,
          extensions: [
            lineNumbers(),
            history(),
            drawSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            markdown({ base: markdownLanguage, codeLanguages: [] }),
            markdownLineStyle,
            EditorView.lineWrapping,
            // Browser spellcheck, in the document's own language if it names one.
            EditorView.contentAttributes.of({
              spellcheck: "true",
              autocorrect: "off",
              autocapitalize: "off",
              lang: langRef.current,
            }),
            editable.current.of(EditorView.editable.of(true)),
            // The document typeset where you type it. Marks stay in the text and
            // are hidden by decorations, so nothing about the file changes. It
            // is only on for the Live view: built unconditionally, a remembered
            // Editor view opened typeset anyway, because the effect that turns
            // it off had already run and found no editor to reconfigure.
            liveOn.current.of(
              layoutRef.current === "live" ? liveLayer(resolveSrc, () => bibRef.current) : [],
            ),
            // The editing behaviour the other editor has, minus the parts that
            // belong to comments and suggest mode: those are phase 3 and need
            // storage decisions this editor has deliberately not made.
            bracketMatching(),
            closeBrackets(),
            codeFolding(),
            foldGutter(),
            mistFolds,
            criticMarkup,
            fencedDivStyle,
            autocompletion({
              override: [
                slashSource(),
                citationSource(() => bibRef.current),
                classSource(() => CSS_CLASSES),
                iconSource(),
              ],
              icons: false,
            }),
            wrapKeymap,
            wrapOnSelection,
            suggestMode(() => modeRef.current),
            // The floating bar on a selection: Comment, and the three tracked
            // changes. All four write CriticMarkup into the text, so none of
            // them needs anything stored anywhere.
            selectionToolbar(() => !conflicted.current),
            keymap.of([
              {
                key: "Mod-Alt-m",
                run: () => {
                  window.dispatchEvent(new CustomEvent("mist-comment"));
                  return true;
                },
              },
              {
                key: "Mod-s",
                run: () => {
                  saveNowRef.current();
                  return true;
                },
              },
              ...closeBracketsKeymap,
              ...completionKeymap,
              ...foldKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((u) => {
              if (u.selectionSet && !u.docChanged) setCursorOffset(u.state.selection.main.head);
              if (!u.docChanged) return;
              setText(u.state.doc.toString());
              setCursorOffset(u.state.selection.main.head);
              const fromUser = u.transactions.some((tr) => !tr.annotation(Transaction.remote));
              if (!fromUser) return;
              if (conflicted.current) return; // the user has a choice to make first
              setStatus("dirty");
              touchedRef.current();
            }),
          ],
        });
        view.current = new EditorView({ state, parent: host.current });
        setEditorView(view.current);
        setText(first);
        setStatus("clean");
      }
    }

    return () => {
      // Hand the buffer back to the ref the editor is built from, so a rebuild
      // starts from what is on screen rather than from what the file held when
      // it was first read.
      if (view.current) initial.current = view.current.state.doc.toString();
      view.current?.destroy();
      view.current = null;
      setEditorView(null);
    };
  }, [sync.ready, resolveSrc]);

  /** Take the version on disk, keeping a copy of this buffer first. */
  const takeDisk = useCallback(async () => {
    if (!view.current) return;
    await sync.saveRecovery();
    await sync.takeDisk();
    conflicted.current = false;
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorView.editable.of(true)),
    });
    setNote("Your version was saved beside the file before it was replaced.");
  }, [sync]);

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-medium text-ink">{name}</span>
        <span className="text-xs uppercase tracking-wider text-muted">{describe(status)}</span>
        <CommitButton
          fileId={fileId}
          unsaved={status === "dirty" || status === "saving"}
          saveNow={() => saveNowRef.current()}
        />
        {status === "conflict" && (
          <button
            type="button"
            onClick={takeDisk}
            className="upstream-flash cursor-pointer rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider"
          >
            File changed on disk — load it
          </button>
        )}
        {note && <span className="truncate text-xs text-muted">{note}</span>}
        <span className="ml-auto flex items-center overflow-hidden rounded border border-border">
          {(["edit", "suggest"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                remember(MODE_KEY, m);
                setMode(m);
              }}
              title={
                m === "suggest"
                  ? "Your edits become tracked changes in the text itself"
                  : "Your edits are applied"
              }
              className={`cursor-pointer px-2 py-1 text-xs uppercase tracking-wider ${
                mode === m ? "bg-border text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {m === "edit" ? "Editing" : "Suggesting"}
            </button>
          ))}
        </span>
        <button
          type="button"
          onClick={() =>
            setReviewOpen((o) => {
              remember(REVIEW_KEY, o ? "no" : "yes");
              return !o;
            })
          }
          title="Suggested edits and comments"
          className={`cursor-pointer rounded px-2 py-1 text-xs uppercase tracking-wider ${
            reviewOpen ? "bg-border text-ink" : "text-muted hover:text-ink"
          }`}
        >
          Review
        </button>
        <button
          type="button"
          onClick={() =>
            setOutlineOpen((o) => {
              remember(OUTLINE_KEY, o ? "no" : "yes");
              return !o;
            })
          }
          title="Contents"
          className={`ml-auto cursor-pointer rounded px-2 py-1 text-xs uppercase tracking-wider ${
            outlineOpen ? "bg-border text-ink" : "text-muted hover:text-ink"
          }`}
        >
          Contents
        </button>
        {deck && (
          <button
            type="button"
            onClick={enterPresent}
            title="Present (Ctrl/Cmd+Alt+P)"
            className="cursor-pointer rounded px-2 py-1 text-xs uppercase tracking-wider text-muted hover:text-ink"
          >
            Present
          </button>
        )}
        <span className="flex items-center overflow-hidden rounded border border-border">
          {(["live", "editor", "split", "preview"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                remember(VIEW_KEY, v);
                setLayout(v);
              }}
              className={`cursor-pointer px-2 py-1 text-xs uppercase tracking-wider ${
                layout === v ? "bg-border text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </span>
      </header>
      {alreadyOpen && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-sm uppercase tracking-wider text-amber-600">
            Already open in another window
          </span>
          <p className="max-w-md text-sm text-muted">
            This file is open in another tab or window, possibly a minimised one. Two windows on
            one file are two separate copies, and whichever saves last wins, so this one will not
            read or write it. Close the other window and this page will open by itself. Chrome's
            tab search, Ctrl+Shift+A, finds a tab you cannot see.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm uppercase tracking-wider text-ink hover:bg-border"
          >
            Reload anyway
          </button>
        </div>
      )}
      {presenting && (
        <div className="fixed inset-0 z-50 bg-black">
          <SlidesView {...slideProps} />
          {railOpen && (
            <PresenterRail
              markdown={text}
              frontmatter={frontmatter}
              currentSlide={slideIndexForOffset(text, cursorOffset)}
              startedAt={presentStart}
              onMouseLeave={() => setRailOpen(false)}
            />
          )}
          {!railOpen && (
            // A right-edge target that reveals the presenter card on hover.
            <div
              onMouseEnter={() => setRailOpen(true)}
              title="Presenter info"
              className="absolute right-0 top-1/2 z-40 h-48 w-4 -translate-y-1/2"
            />
          )}
          <button
            type="button"
            onClick={exitPresent}
            title="Exit present (Esc)"
            aria-label="Exit present"
            className="absolute right-3 top-3 cursor-pointer rounded bg-black/40 px-2 py-1 text-xs uppercase tracking-wider text-white/70 hover:text-white"
          >
            Exit
          </button>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 ${alreadyOpen || presenting ? "hidden" : ""}`}>
        {outlineOpen && (
          <div className="min-h-0 w-64 shrink-0 overflow-auto border-r border-border">
            <OutlinePanel
              view={editorView}
              text={text}
              deck={deck}
              canEdit={status !== "conflict"}
              onClose={() => setOutlineOpen(false)}
            />
          </div>
        )}
        <div
          ref={host}
          className={`min-h-0 overflow-auto ${
            layout === "preview"
              ? "hidden"
              : layout === "split"
                ? "w-1/2 border-r border-border"
                : "flex-1"
          }`}
        />
        {/* Live is the editor alone, typeset in place. Only split and preview put a
            second pane beside it. For a deck that pane is the deck itself. */}
        {(layout === "split" || layout === "preview") && (
          <div className={layout === "split" ? "min-h-0 w-1/2" : "min-h-0 flex-1"}>
            {deck ? (
              <SlidesView {...slideProps} />
            ) : (
              <PlainPreview
                markdown={text}
                drive={folderId ? ({ fileId, name, folderId } as DriveMeta) : null}
                bibLib={bibLib}
              />
            )}
          </div>
        )}
        {reviewOpen && (
          <div className="min-h-0 w-72 shrink-0">
            <PlainReview view={editorView} text={text} onClose={() => setReviewOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

function describe(status: Status): string {
  if (status === "loading") return "opening";
  if (status === "dirty") return "unsaved";
  if (status === "saving") return "saving";
  if (status === "conflict") return "";
  if (status === "error") return "";
  return "saved";
}
