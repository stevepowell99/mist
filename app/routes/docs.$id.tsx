import { data, Link } from "react-router";
import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocRole, DriveMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { mintAssetToken, mintAssetTokenForDoc, authorizeDoc, type DriveSessionEnv } from "~/lib/drive-access.server";
import { EditorView } from "@codemirror/view";
import { modAltChord } from "~/lib/chord";
import { offsetForSlideIndex, slideIndexForOffset } from "~/lib/slide-cursor";
import { docFileKey, loadDocSettings, saveDocSettings } from "~/lib/doc-settings";
import { usePresence } from "~/lib/usePresence";
import PresenceBar from "~/components/PresenceBar";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import CodeMirrorEditor from "~/components/CodeMirrorEditor";
import Preview from "~/components/Preview";
import ConnectionStatus from "~/components/ConnectionStatus";
import UserName from "~/components/UserName";
import SaveStatus from "~/components/SaveStatus";
import ShareButton from "~/components/ShareButton";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import NamePrompt from "~/components/NamePrompt";
import FolderSidebar from "~/components/FolderSidebar";
import OutlinePanel from "~/components/OutlinePanel";
import HelpPanel from "~/components/HelpPanel";
import GoogleSignIn from "~/components/GoogleSignIn";
import SlidesView, { isSlideDeck } from "~/components/SlidesView";

// useLayoutEffect on the client (so scroll is restored before paint, no flash),
// useEffect on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function fileTitle(drive: DriveMeta | null, fallback: string): string {
  const raw = drive?.name;
  if (!raw) return fallback;
  const name = raw.replace(/\.(md|qmd)$/i, "");
  return name || fallback;
}

export function meta({ data }: Route.MetaArgs) {
  const drive = data && "drive" in data ? data.drive : null;
  const title = drive ? fileTitle(drive, "mist") : "mist";
  return [{ title: title || "mist" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const docKey = searchParams.get("k");
  const initialPreview = searchParams.get("view") === "preview";
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(
    new Request(`https://do/?k=${encodeURIComponent(docKey ?? "")}`),
  );
  const { exists, createdAt, role, suggestKey, drive } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    role: DocRole | null;
    suggestKey?: string;
    drive: DriveMeta | null;
  };

  if (!exists || !role) {
    throw data(null, { status: 404 });
  }

  // The secret link is NOT sufficient: a Drive-bound doc requires a signed-in
  // user the file is shared with (Drive sharing is the source of truth). The
  // same check gates the WebSocket in workers/app.ts. The effective role is the
  // more restrictive of the link's role and the user's Drive role.
  const auth = await authorizeDoc(env as unknown as DriveSessionEnv, request, drive, role);
  if (auth.status === "badkey") throw data(null, { status: 404 });
  if (auth.status === "needsAuth") return { id, gate: "needsAuth" as const };
  if (auth.status === "forbidden") return { id, gate: "forbidden" as const };
  const effectiveRole = auth.role ?? role;

  // Short-lived token so the sandboxed slides iframe (and document preview) can
  // fetch private-Drive assets without the session cookie.
  const assetToken =
    (await mintAssetTokenForDoc(env as unknown as DriveSessionEnv, !!role)) ??
    (await mintAssetToken(request, env as unknown as DriveSessionEnv));

  return {
    id,
    createdAt,
    role: effectiveRole,
    suggestKey: effectiveRole === "edit" ? suggestKey ?? null : null,
    docKey,
    drive,
    initialPreview,
    assetToken,
    gate: null,
  };
}

// Navbar toggle icons. Stroke-only 18px glyphs so they sit quietly in the bar.
const svg = (paths: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);
const IconEditing = () => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
const IconSuggesting = () => svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />);
const IconEditorOnly = () => svg(<><path d="M4 6h16M4 10h16M4 14h10M4 18h10" /></>);
const IconSplit = () => svg(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16" /></>);
const IconPreviewOnly = () => svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);

/** A segmented navbar toggle, kept DRY across the Mode and View groups. */
function ToolbarToggle({
  active,
  onClick,
  title,
  disabled,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`flex items-center px-3 py-1.5 transition-colors ${
        active ? activeClass : "text-muted hover:bg-border hover:text-ink"
      } ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

/** The editor payload (the loader's non-gate return). */
type EditorData = {
  id: string;
  createdAt: number | null;
  role: DocRole;
  suggestKey: string | null;
  docKey: string | null;
  drive: DriveMeta | null;
  initialPreview: boolean;
  assetToken: string | null;
  gate: null;
};

/** Sign-in / no-access screen shown instead of the editor when the viewer is not
 *  authorised for the file. The WebSocket is gated server-side regardless, so
 *  this is the friendly face of that gate. */
function DocGate({ kind }: { kind: "needsAuth" | "forbidden" }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-paper p-6 text-center">
      <Link to="/" className="rounded bg-ink px-3 py-1.5 font-medium text-paper hover:bg-chartreuse hover:text-[#1a1a1a]">
        mist
      </Link>
      {kind === "needsAuth" ? (
        <>
          <p className="max-w-sm text-ink">
            This file is private. Sign in with the Google account it is shared with to open it.
          </p>
          <GoogleSignIn onSignedIn={() => window.location.reload()} />
        </>
      ) : (
        <p className="max-w-sm text-ink">
          You do not have access to this file. Ask the owner to share it with your Google
          account in Google Drive, then reload.
        </p>
      )}
    </div>
  );
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  // Not authorised for this file: show the sign-in / no-access screen, never the
  // editor (and the WebSocket is gated server-side too).
  if (loaderData.gate) return <DocGate kind={loaderData.gate} />;
  // React Router reuses this component across /docs/X to /docs/Y navigation, so
  // key the whole subtree on the document id. This remounts DocumentRoot, which
  // OWNS the Y.Doc (in useYjsEditor). Without a fresh Y.Doc per id, the previous
  // file's content stays in the doc and the next file syncs INTO it, merging the
  // two (the concatenation/corruption bug). The key must sit above useYjsEditor.
  return <DocumentRoot key={loaderData.id} {...loaderData} />;
}

function DocumentRoot({
  id,
  createdAt,
  role,
  suggestKey,
  docKey,
  drive,
  initialPreview,
  assetToken,
}: EditorData) {
  const yjs = useYjsEditor(id, docKey);

  return (
    <DocumentProvider
      docId={id}
      createdAt={createdAt}
      yjs={yjs}
      role={role}
      docKey={docKey}
      suggestKey={suggestKey}
      drive={drive}
      initialPreview={initialPreview}
      assetToken={assetToken}
    >
      <DocumentLayout id={id} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id }: { id: string }) {
  const {
    yjs,
    view: editorView,
    cursorOffset,
    showPreview,
    previewToggled,
    handleViewReady,
    setEditorText,
    activeCommentRange,
    cleanView,
    setCursor,
    mode,
    toggleMode,
    role,
    drive,
    bibLib,
    markdown,
    frontmatter,
    setPreview,
    threads,
    docKey,
    uploadImage,
    cssClasses,
    saveNow,
    backed,
    autoSave,
    setAutoSave,
    followCursor,
    setFollowCursor,
    setCleanView,
  } = useDocument();

  const title = fileTitle(drive, id);
  const deck = isSlideDeck(markdown, frontmatter);
  const slidesMode = showPreview && deck;

  // Desktop-only draggable split: drag the gutter left to put the editor on the
  // left and a live preview on the right. editorPct is the editor's width; at
  // 100 there is no split. Mobile keeps the full-swap Preview toggle.
  const [isDesktop, setIsDesktop] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [editorPct, setEditorPct] = useState(() => {
    // Open in split if the URL asks for it (?view=split), so a reload or shared
    // link reopens the same layout. Preview-only is restored via initialPreview.
    if (typeof window === "undefined") return 100;
    return new URL(window.location.href).searchParams.get("view") === "split" ? 50 : 100;
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const splitOpen = isDesktop && editorPct <= 95;
  // A deck previewed full-screen (not split) renders in the same flex section as
  // the split preview, so the iframe gets a definite height and reveal can size
  // the deck. Nesting it inside <main> collapses the iframe to zero height.
  const slidesFull = slidesMode && !splitOpen;

  // The View is one of three exclusive layouts. It is derived from the preview
  // toggle and split ratio, and setView drives both, so the navbar, keyboard and
  // URL all speak the same three-state language.
  const view: "editor" | "split" | "preview" = splitOpen ? "split" : showPreview ? "preview" : "editor";
  const setView = useCallback(
    (v: "editor" | "split" | "preview") => {
      if (v === "preview") {
        setPreview(true);
        setEditorPct(100);
      } else if (v === "split") {
        setPreview(false);
        setEditorPct(50);
      } else {
        setPreview(false);
        setEditorPct(100);
      }
    },
    [setPreview],
  );

  // Nudge the split ratio by `delta` percent (editor width). Opens the split
  // from a baseline of 50 if it is not open yet, so the resize keys also enter
  // split. Desktop only; clamped to the drag range.
  const nudgeSplit = useCallback(
    (delta: number) => {
      if (!isDesktop) return;
      setPreview(false);
      setEditorPct((p) => Math.min(95, Math.max(20, (p <= 95 ? p : 50) + delta)));
    },
    [isDesktop, setPreview],
  );

  // Publish the header height so the sidebar/overlays can sit below it.
  useEffect(() => {
    const h = headerRef.current;
    if (!h) return;
    const apply = () => document.documentElement.style.setProperty("--header-h", `${h.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(h);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--header-h");
    };
  }, []);

  // Collapsible right panel: a thin strip when collapsed, peeking on hover as an
  // overlay so the editor does not reflow. Persistence is per-file (below).
  const [asideCollapsed, setAsideCollapsed] = useState(false);
  const [asidePeek, setAsidePeek] = useState(false);
  const setAsideCollapsedPersist = useCallback((v: boolean) => {
    setAsideCollapsed(v);
    setAsidePeek(false);
  }, []);

  // Per-file UI settings (divider, view, follow-cursor, clean view, comments
  // collapsed): remember the layout each file was left in, and default a new
  // file to the most-recently-used layout. Keyed by the stable file id so it
  // survives re-imports. Theme and the autosave safety toggle stay global.
  const fileKey = docFileKey(drive, id);
  const settingsLoaded = useRef(false);
  useEffect(() => {
    settingsLoaded.current = false;
    const s = loadDocSettings(fileKey);
    // A shared link's ?view wins for the gross layout; otherwise restore the
    // file's saved layout. The cursor/clean/comments toggles are never in the URL.
    const hasUrlView = typeof window !== "undefined" && new URL(window.location.href).searchParams.has("view");
    if (!hasUrlView) {
      if (typeof s.showPreview === "boolean") setPreview(s.showPreview);
      if (typeof s.editorPct === "number") setEditorPct(s.editorPct);
    }
    if (typeof s.followCursor === "boolean") setFollowCursor(s.followCursor);
    if (typeof s.cleanView === "boolean") setCleanView(s.cleanView);
    if (typeof s.asideCollapsed === "boolean") setAsideCollapsed(s.asideCollapsed);
    settingsLoaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);
  useEffect(() => {
    if (!settingsLoaded.current) return;
    // Debounced so a divider drag (editorPct changes per frame) writes once, on
    // settle. previewToggled, not showPreview, so a hover-peek is not persisted.
    const t = setTimeout(() => {
      saveDocSettings(fileKey, { editorPct, showPreview: previewToggled, followCursor, cleanView, asideCollapsed });
    }, 200);
    return () => clearTimeout(t);
  }, [fileKey, editorPct, previewToggled, followCursor, cleanView, asideCollapsed]);

  // Collaborative presence: broadcast the slide this user is on (the deck's
  // current slide when its preview is visible, otherwise the editor cursor's
  // slide) and read the peers, for the navbar avatars and the outline markers.
  const { peers, setLocalSlide } = usePresence(yjs.awareness);
  const [deckSlide, setDeckSlide] = useState<number | null>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number };
      if (d?.type === "mist-slide" && typeof d.h === "number") setDeckSlide(d.h);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const localSlide = useMemo(() => {
    if (!deck) return null;
    if ((splitOpen || slidesFull) && deckSlide != null) return deckSlide;
    return slideIndexForOffset(markdown, cursorOffset);
  }, [deck, splitOpen, slidesFull, deckSlide, markdown, cursorOffset]);
  useEffect(() => {
    setLocalSlide(localSlide);
  }, [localSlide, setLocalSlide]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // The parent folder's name for the navbar breadcrumb. The folder id is on the
  // DriveMeta; its name is the last entry of the folder trail, which the search
  // endpoint already returns, so no new route or schema field is needed.
  const [folderName, setFolderName] = useState<string | null>(null);
  useEffect(() => {
    const fid = drive?.folderId;
    if (!fid) {
      setFolderName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/drive/search?folder=${encodeURIComponent(fid)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { folder?: { trail?: { id: string; name: string }[] } | null };
        const trail = body.folder?.trail ?? [];
        if (!cancelled) setFolderName(trail.length ? trail[trail.length - 1].name : null);
      } catch {
        // the navbar folder label is best-effort; a failure just hides it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drive?.folderId]);

  // Mirror the per-viewer View into the URL so a reload or a copied link
  // restores the same layout. replaceState keeps it out of the back-stack.
  // Editor is the default, so it carries no param. Mode (edit/suggest) is shared
  // doc state, so it stays out of the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (view === "editor") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [view]);

  // One place runs every mod+alt shortcut, fed by three sources so focus never
  // matters: the window (page/toolbar), the editor (a CodeMirror keydown
  // handler), and the sandboxed slides iframe (which forwards chords by
  // postMessage, since its keys never reach this window). Mode: E/S. View:
  // 1/2/3. Panels: O outline, C comments, F Drive sidebar, / help. Resize: - =.
  // The folder and help panels own their open state, so they are toggled by a
  // custom event rather than reaching into them here.
  // Reverse sync: move the editor cursor to the source of the slide currently
  // shown in the preview (the deck reports it into ?slide). Held in a ref so the
  // shortcut handler does not rebuild on every keystroke as markdown changes.
  const syncEditorToSlideRef = useRef<() => void>(() => {});
  syncEditorToSlideRef.current = () => {
    if (!editorView) return;
    const s = typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("slide") : null;
    const idx = s && /^\d+$/.test(s) ? Number(s) : 0;
    const pos = Math.min(offsetForSlideIndex(markdown, idx), editorView.state.doc.length);
    // y:"start" puts the slide's heading near the top of the viewport (a small
    // margin above), rather than scrollIntoView's default of the nearest edge,
    // which left the heading at the very bottom when scrolling down.
    editorView.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 48 }),
    });
    editorView.focus();
  };

  const runChord = useCallback(
    (c: string): boolean => {
      switch (c) {
        // S toggles the binary edit/suggest mode (a no-op for suggest-only links).
        case "s": toggleMode(); return true;
        case "1": setView("editor"); return true;
        case "2": if (isDesktop) setView("split"); return true;
        case "3": setView("preview"); return true;
        // D opens the outline / slide list (the slide-out TOC).
        case "d": setOutlineOpen((v) => !v); return true;
        case "c": setAsideCollapsedPersist(!asideCollapsed); return true;
        // Resize on - / = (not [ / ], which CodeMirror uses for fold-all).
        case "-": nudgeSplit(-5); return true;
        case "=": nudgeSplit(5); return true;
        case "f": window.dispatchEvent(new CustomEvent("mist-toggle-folder")); return true;
        case "g": syncEditorToSlideRef.current(); return true;
        case "/": window.dispatchEvent(new CustomEvent("mist-toggle-help")); return true;
        default: return false;
      }
    },
    [toggleMode, setView, isDesktop, setAsideCollapsedPersist, asideCollapsed, nudgeSplit],
  );

  // Ctrl/Cmd+S (and Ctrl/Cmd+Enter, dispatched by the editor) flushes a save to
  // the backend now and refreshes the deck preview. The deck rebuild is handled
  // in SlidesView; here we force the write so "save" actually saves.
  useEffect(() => {
    const onSave = () => saveNow();
    window.addEventListener("mist-rebuild-deck", onSave);
    return () => window.removeEventListener("mist-rebuild-deck", onSave);
  }, [saveNow]);

  useEffect(() => {
    // Bubble phase: the editor handles its own keydown first and stops
    // propagation, so this only runs when focus is elsewhere (toolbar, body),
    // avoiding a double-toggle.
    const onKey = (e: KeyboardEvent) => {
      const c = modAltChord(e);
      if (c && runChord(c)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    // The slides iframe can't share our window, so it posts chords to us.
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; chord?: string };
      if (d?.type === "mist-key" && typeof d.chord === "string") runChord(d.chord);
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("message", onMsg);
    };
  }, [runChord]);

  const startDrag = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // rAF-throttle: each mousemove reflows the iframe-heavy layout, so coalesce
    // to one resize per frame to keep the drag smooth.
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
      // mist-dragging lets the mouse pass through the iframe so the drag never
      // stalls when the cursor is over the preview pane.
      document.body.classList.remove("mist-dragging");
      if (raf) cancelAnimationFrame(raf);
    };
    document.body.style.userSelect = "none";
    document.body.classList.add("mist-dragging");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // The editor and Preview share this scroll container, so swapping between
  // them would otherwise jump to the top. Track the scroll fraction and restore
  // it when the view flips, re-applying as Preview's content settles (it mounts
  // empty then fills in, which changes the scroll height).
  const mainRef = useRef<HTMLElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const scrollFraction = useRef(0);
  const restoring = useRef(false);

  const applyFraction = useCallback(() => {
    const m = mainRef.current;
    if (!m) return;
    const max = m.scrollHeight - m.clientHeight;
    m.scrollTop = max > 0 ? scrollFraction.current * max : 0;
  }, []);

  const handleScroll = useCallback(() => {
    if (restoring.current) return;
    const m = mainRef.current;
    if (!m) return;
    const max = m.scrollHeight - m.clientHeight;
    scrollFraction.current = max > 0 ? m.scrollTop / max : 0;
  }, []);

  useIsomorphicLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // Preview mounts empty then renders its markdown (and images) over several
    // frames, so a one-shot restore lands at the wrong height. Re-apply the
    // fraction each frame until the scroll height holds steady, then stop.
    restoring.current = true;
    let raf = 0;
    let lastHeight = -1;
    let stableFrames = 0;
    const start = performance.now();
    const tick = () => {
      applyFraction();
      const h = main.scrollHeight;
      if (h === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = h;
      }
      if (stableFrames < 4 && performance.now() - start < 700) {
        raf = requestAnimationFrame(tick);
      } else {
        restoring.current = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      restoring.current = false;
    };
  }, [showPreview, applyFraction]);

  // In the desktop split with the document preview, sync the two panes'
  // y-scroll. Pure proportional drifts on long docs because headings/images
  // expand differently, so anchor on headings (which exist in both) and
  // interpolate between them, falling back to proportional when they do not
  // line up. A flag breaks the feedback loop between the two listeners.
  useEffect(() => {
    if (!splitOpen || slidesMode) return;
    const ed = mainRef.current;
    const pv = previewScrollRef.current;
    const edRoot = editorView?.contentDOM as HTMLElement | undefined;
    if (!ed || !pv || !edRoot) return;

    const offsetIn = (el: Element, container: HTMLElement) =>
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

    // Anchor pairs (editorTop, previewTop), bracketed by the scroll extremes.
    const anchors = (): { from: number; to: number }[] | null => {
      const edHeads = Array.from(edRoot.children).filter((c) =>
        /^#{1,6}\s/.test((c.textContent ?? "").trimStart()),
      );
      const pvHeads = Array.from(pv.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      if (edHeads.length < 1 || edHeads.length !== pvHeads.length) return null;
      const pairs = edHeads.map((e, i) => ({ from: offsetIn(e, ed), to: offsetIn(pvHeads[i], pv) }));
      return [{ from: 0, to: 0 }, ...pairs];
    };

    const interp = (top: number, pairs: { from: number; to: number }[], toMax: number) => {
      for (let i = pairs.length - 1; i >= 0; i--) {
        if (top >= pairs[i].from) {
          const next = pairs[i + 1];
          if (!next) return Math.min(pairs[i].to + (top - pairs[i].from), toMax);
          const span = next.from - pairs[i].from || 1;
          const frac = (top - pairs[i].from) / span;
          return pairs[i].to + frac * (next.to - pairs[i].to);
        }
      }
      return top;
    };

    const sync = (from: HTMLElement, to: HTMLElement, dir: "fromEd" | "fromPv") => {
      if (syncingScroll.current) return;
      syncingScroll.current = true;
      const toMax = to.scrollHeight - to.clientHeight;
      const pairs = anchors();
      let target: number;
      if (pairs) {
        const mapped = dir === "fromEd" ? pairs : pairs.map((p) => ({ from: p.to, to: p.from }));
        target = interp(from.scrollTop, mapped, toMax);
      } else {
        const fromMax = from.scrollHeight - from.clientHeight;
        target = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
      }
      to.scrollTop = Math.max(0, Math.min(target, toMax));
      requestAnimationFrame(() => {
        syncingScroll.current = false;
      });
    };
    const onEd = () => sync(ed, pv, "fromEd");
    const onPv = () => sync(pv, ed, "fromPv");
    ed.addEventListener("scroll", onEd);
    pv.addEventListener("scroll", onPv);
    return () => {
      ed.removeEventListener("scroll", onEd);
      pv.removeEventListener("scroll", onPv);
    };
  }, [splitOpen, slidesMode, editorView]);

  return (
    <div className="flex h-screen flex-col">
      <header ref={headerRef} className="flex items-stretch border-b border-border">
        <Link
          to="/"
          className="flex shrink-0 items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          mist
        </Link>
        <FolderSidebar />
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          title={`${deck ? "Slide list" : "Outline"} (Ctrl/Cmd+Alt+O)`}
          aria-label="Toggle outline"
          aria-pressed={outlineOpen}
          className={`flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors ${outlineOpen ? "bg-ink text-paper" : "hover:bg-border hover:text-ink"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        {deck && (
          <button
            type="button"
            onClick={() => syncEditorToSlideRef.current()}
            title="Jump editor to the current slide (Ctrl/Cmd+Alt+G)"
            aria-label="Jump editor to current slide"
            className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-border hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" />
            </svg>
          </button>
        )}
        <div className="flex min-w-0 grow items-center gap-2 px-4">
          <span
            className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs uppercase tracking-wider text-muted sm:inline-block"
            title={deck ? "Slide deck (format: revealjs)" : "Document"}
          >
            {deck ? "Deck" : "Doc"}
          </span>
          {/* Parent folder, paler and clickable: opens the Drive sidebar (which
              starts at this folder). Hidden on the narrowest screens for room. */}
          {folderName && (
            <span className="hidden min-w-0 shrink items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("mist-toggle-folder"))}
                title={`Open folder: ${folderName}`}
                className="max-w-[12rem] cursor-pointer truncate text-muted opacity-70 hover:underline hover:opacity-100"
              >
                {folderName}
              </button>
              <span className="text-muted opacity-50">/</span>
            </span>
          )}
          <span className="truncate font-medium" title={title}>{title}</span>
        </div>
        {/* Two separate radio pills so the grouping reads at a glance: Mode
            (Editing vs Suggesting, shared doc state, only an edit-link user can
            switch) and View (Editor / Split / Preview, per-viewer). Shown at
            every width: these are the single mode/view control, on mobile too
            (Split is desktop-only and drops out below lg). */}
        <div className="flex shrink-0 items-center gap-2 border-l border-border pl-3 pr-1">
          <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">
            <ToolbarToggle
              active={mode === "edit"}
              onClick={() => role === "edit" && mode !== "edit" && toggleMode()}
              disabled={role !== "edit"}
              title="Editing (Ctrl/Cmd+Alt+E)"
              activeClass="bg-coral text-paper"
            >
              <IconEditing />
            </ToolbarToggle>
            <ToolbarToggle
              active={mode === "suggest"}
              onClick={() => mode !== "suggest" && role === "edit" && toggleMode()}
              disabled={role !== "edit"}
              title="Suggesting (Ctrl/Cmd+Alt+S)"
              activeClass="bg-amber-500 text-paper"
            >
              <IconSuggesting />
            </ToolbarToggle>
          </div>
          <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">
            <ToolbarToggle
              active={view === "editor"}
              onClick={() => setView("editor")}
              title="Editor only (Ctrl/Cmd+Alt+1)"
              activeClass="bg-ink text-paper"
            >
              <IconEditorOnly />
            </ToolbarToggle>
            {isDesktop && (
              <ToolbarToggle
                active={view === "split"}
                onClick={() => setView("split")}
                title="Split (Ctrl/Cmd+Alt+2)"
                activeClass="bg-ink text-paper"
              >
                <IconSplit />
              </ToolbarToggle>
            )}
            <ToolbarToggle
              active={view === "preview"}
              onClick={() => setView("preview")}
              title="Preview only (Ctrl/Cmd+Alt+3)"
              activeClass="bg-emerald-600 text-paper"
            >
              <IconPreviewOnly />
            </ToolbarToggle>
          </div>
        </div>
        {/* On desktop the right group is the aside width so its left edge lines up with
            the body/sidebar divide. On mobile there is no sidebar, so it sizes naturally. */}
        <div className="flex shrink-0 items-stretch lg:w-96">
          <div className="flex items-center border-l border-border px-3 lg:min-w-0 lg:flex-1 lg:justify-center lg:overflow-hidden lg:px-2">
            <ConnectionStatus />
          </div>
          {peers.length > 0 && (
            <div className="hidden shrink-0 items-center border-l border-border px-2 lg:flex">
              <PresenceBar peers={peers} />
            </div>
          )}
          <div className="hidden shrink-0 items-center border-l border-border lg:flex">
            <UserName />
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <SaveStatus />
          </div>
          <div className="shrink-0 border-l border-border">
            <ShareButton />
          </div>
          <div className="flex shrink-0 items-center border-l border-border">
            <ThemeSelector />
          </div>
        </div>
      </header>
      <div className="relative flex flex-1 overflow-hidden">
        {!yjs.synced && !yjs.paused && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-paper">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-ink" />
            <span className="text-sm uppercase tracking-wider text-muted">Loading document…</span>
          </div>
        )}
        {yjs.paused && (
          <button
            type="button"
            onClick={yjs.resume}
            title="The live connection was paused while idle to save resources. Click, type or scroll to reconnect."
            className="absolute left-1/2 top-2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-paper px-3 py-1 text-xs uppercase tracking-wider text-muted shadow hover:text-ink"
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            Paused while idle, click to reconnect
          </button>
        )}
        <div ref={contentRef} className="flex flex-1 overflow-hidden">
          {outlineOpen && (
            <OutlinePanel
              view={editorView}
              text={markdown}
              deck={deck}
              canEdit={role === "edit"}
              peers={peers}
              onClose={() => setOutlineOpen(false)}
            />
          )}
          <main
            ref={mainRef}
            onScroll={handleScroll}
            className={`lg:border-r lg:border-border ${
              slidesFull
                ? "hidden"
                : splitOpen
                  ? "shrink-0 overflow-y-auto"
                  : "flex-1 overflow-y-auto pb-20 lg:pb-0"
            }`}
            style={splitOpen ? { width: `${editorPct}%` } : undefined}
          >
            <div className={`min-h-full ${(splitOpen ? false : showPreview) ? "hidden" : ""}`}>
              <CodeMirrorEditor
                doc={yjs.doc}
                awareness={yjs.awareness}
                mode={mode}
                cleanView={cleanView}
                activeComment={activeCommentRange}
                bibLibrary={bibLib}
                classList={cssClasses}
                onTextChange={setEditorText}
                onCursorChange={setCursor}
                onViewReady={handleViewReady}
                onImagePaste={drive ? uploadImage : undefined}
                onShortcut={runChord}
                className="min-h-full text-base"
              />
            </div>
            {/* Full-screen document preview stays inside main (it scrolls with
                the editor). A deck preview instead renders in the section below. */}
            {!splitOpen && showPreview && !deck && <Preview />}
          </main>
          {isDesktop && !slidesFull && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              title="Drag to split editor and preview"
              className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-chartreuse"
            >
              {/* widen the grab target a few px into each pane */}
              <span className="absolute inset-y-0 -left-1 -right-1" />
              {/* grip dots so the handle is findable */}
              <span className="pointer-events-none flex flex-col gap-1 opacity-50 group-hover:opacity-90">
                <span className="h-1 w-1 rounded-full bg-ink" />
                <span className="h-1 w-1 rounded-full bg-ink" />
                <span className="h-1 w-1 rounded-full bg-ink" />
              </span>
            </div>
          )}
          {(splitOpen || slidesFull) && (
            <section className="flex-1 overflow-hidden">
              {deck ? <SlidesView /> : <div ref={previewScrollRef} className="h-full overflow-y-auto"><Preview /></div>}
            </section>
          )}
        </div>
        {/* Collapsed strip: essentials only (expand control + comment count). */}
        {asideCollapsed && !asidePeek && (
          <div
            onMouseEnter={() => setAsidePeek(true)}
            className="hidden w-9 shrink-0 flex-col items-center gap-3 border-l border-border py-2 lg:flex"
          >
            <button
              type="button"
              onClick={() => setAsideCollapsedPersist(false)}
              title="Expand comments (Ctrl/Cmd+Alt+C)"
              aria-label="Expand panel"
              className="cursor-pointer p-1 text-muted hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {threads.length > 0 && (
              <span className="mt-1 rounded bg-coral/20 px-1 text-xs text-coral" title={`${threads.length} comments`}>
                {threads.length}
              </span>
            )}
          </div>
        )}
        {(!asideCollapsed || asidePeek) && (
          <aside
            onMouseLeave={() => asidePeek && setAsidePeek(false)}
            className={`hidden w-96 flex-col overflow-hidden border-l border-border bg-paper lg:flex ${
              asidePeek ? "panel-slide-right absolute right-0 top-0 z-30 h-full shadow-lg" : ""
            }`}
          >
            <div className="flex shrink-0 items-stretch border-b border-border">
              <button
                type="button"
                onClick={() => setAsideCollapsedPersist(true)}
                title="Collapse comments (Ctrl/Cmd+Alt+C)"
                aria-label="Collapse panel"
                className="flex cursor-pointer items-center px-2 text-muted hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              <span className="flex flex-1 items-center px-3 text-sm uppercase tracking-wider text-muted">
                Comments
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <OnboardingBanner />
              <SuggestionActions />
              {mode === "suggest" && <CleanViewToggle />}
              <div className="border-t border-border" />
              <CommentInput />
              <ThreadList />
            </div>
            {(backed || deck) && (
              // pb-14 lifts the toggles clear of the floating ? help button,
              // which is fixed over the bottom-right corner (this aside's foot).
              <div className="shrink-0 border-t border-border pb-14">
                {backed && (
                  <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-muted hover:text-ink">
                    <span title="When off, edits do not write to Drive automatically. Manual save (Ctrl/Cmd+S or the Saving badge) still works.">
                      Autosave to Drive
                    </span>
                    <input
                      type="checkbox"
                      checked={autoSave}
                      onChange={(e) => setAutoSave(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-coral"
                    />
                  </label>
                )}
                {deck && (
                  <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-muted hover:text-ink">
                    <span title="When off, the slide preview stops jumping to follow the editor cursor. Turn off on a large deck for a snappier editor.">
                      Follow cursor in slides
                    </span>
                    <input
                      type="checkbox"
                      checked={followCursor}
                      onChange={(e) => setFollowCursor(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-coral"
                    />
                  </label>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      <MobilePanel className="lg:hidden" />
      <NamePrompt />
      <HelpPanel />
    </div>
  );
}
