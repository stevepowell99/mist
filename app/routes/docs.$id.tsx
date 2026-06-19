import { data, Link } from "react-router";
import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { APP_NAME, isValidDocumentId } from "~/shared/constants";
import type { DocRole, DriveMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { mintAssetToken, mintAssetTokenForDoc, authorizeDoc, type DriveSessionEnv } from "~/lib/drive-access.server";
import { EditorView } from "@codemirror/view";
import { useChordListener } from "~/lib/useChordListener";
import { QuickOpenTrigger } from "~/components/QuickOpen";
import { useSplitDrag } from "~/lib/useSplitDrag";
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
import PresenterRail from "~/components/PresenterRail";
import HelpPanel from "~/components/HelpPanel";
import LibraryGallery from "~/components/LibraryGallery";
import GoogleSignIn from "~/components/GoogleSignIn";
import SlidesView, { isSlideDeck } from "~/components/SlidesView";
import { fillPrintTab } from "~/lib/print-paged.client";

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
  const title = drive ? fileTitle(drive, APP_NAME) : APP_NAME;
  return [{ title: title || APP_NAME }];
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
        {APP_NAME}
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
    markUserEdited,
    activeCommentRange,
    cleanView,
    setCursor,
    mode,
    toggleMode,
    role,
    drive,
    docKey,
    assetToken,
    bibLib,
    markdown,
    frontmatter,
    setPreview,
    uploadImage,
    cssClasses,
    saveNow,
    backed,
    autoSave,
    setAutoSave,
    followCursor,
    setFollowCursor,
    setCleanView,
    commentActive,
  } = useDocument();

  const title = fileTitle(drive, id);
  const deck = isSlideDeck(markdown, frontmatter);
  const slidesMode = showPreview && deck;
  // Default split ratio (editor width) when no saved position applies: a slim
  // editor for a deck so the slide preview dominates, a bit wider for a document.
  const defaultEditorPct = deck ? 25 : 35;
  // Spellcheck language: a top-level `lang:` (or `language:`) in the frontmatter,
  // default British English. Drives the editor's browser spellcheck.
  const lang =
    frontmatter.match(/^\s*lang(?:uage)?:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") || "en-GB";

  // Desktop-only draggable split: drag the gutter left to put the editor on the
  // left and a live preview on the right. editorPct is the editor's width; at
  // 100 there is no split. Mobile keeps the full-swap Preview toggle.
  const [isDesktop, setIsDesktop] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Present mode: the deck fills the (fullscreened) app, chrome hidden, with an
  // optional presenter rail. One mode, app-controlled (we fullscreen the app, not
  // the deck iframe, so our own UI can sit over/beside the slide).
  const [presenting, setPresenting] = useState(false);
  const [presentStart, setPresentStart] = useState(0);
  // The presenter card (bottom-right): railOpen is the persistent toggle
  // (Ctrl/Cmd+Alt+N), railPeek is the on-hover reveal.
  const [railOpen, setRailOpen] = useState(false);
  const [railPeek, setRailPeek] = useState(false);
  const [editorPct, setEditorPct] = useState(() => {
    // Open in split if the URL asks for it (?view=split), so a reload or shared
    // link reopens the same layout. Preview-only is restored via initialPreview.
    if (typeof window === "undefined") return 100;
    return new URL(window.location.href).searchParams.get("view") === "split" ? defaultEditorPct : 100;
  });
  // Remember the last split ratio this session so re-entering split (the toggle,
  // a nudge) restores where the divider was, not a fixed 50. Seeded from the
  // saved/default value once settings load.
  const lastSplitPct = useRef(defaultEditorPct);
  useEffect(() => {
    if (editorPct <= 95) lastSplitPct.current = editorPct;
  }, [editorPct]);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const splitOpen = isDesktop && editorPct <= 95;
  // A deck previewed full-screen (not split) renders in the same flex section as
  // the split preview, so the iframe gets a definite height and reveal can size
  // the deck. Nesting it inside <main> collapses the iframe to zero height.
  const slidesFull = slidesMode && !splitOpen;
  // Present mode only applies to a deck; it fills the app and hides the chrome.
  const present = presenting && deck;

  // The View is one of three exclusive layouts. It is derived from the preview
  // toggle and split ratio, and setView drives both, so the navbar, keyboard and
  // URL all speak the same three-state language.
  const view: "editor" | "split" | "preview" = splitOpen ? "split" : showPreview ? "preview" : "editor";
  // Read inside printDoc to restore the view after grabbing the preview HTML.
  const viewRef = useRef(view);
  viewRef.current = view;
  const setView = useCallback(
    (v: "editor" | "split" | "preview") => {
      if (v === "preview") {
        setPreview(true);
        setEditorPct(100);
      } else if (v === "split") {
        setPreview(false);
        setEditorPct(lastSplitPct.current ?? defaultEditorPct);
      } else {
        setPreview(false);
        setEditorPct(100);
      }
    },
    [setPreview, defaultEditorPct],
  );

  // Nudge the split ratio by `delta` percent (editor width). Opens the split
  // from a baseline of 50 if it is not open yet, so the resize keys also enter
  // split. Desktop only; clamped to the drag range.
  const nudgeSplit = useCallback(
    (delta: number) => {
      if (!isDesktop) return;
      setPreview(false);
      setEditorPct((p) => Math.min(95, Math.max(20, (p <= 95 ? p : (lastSplitPct.current ?? defaultEditorPct)) + delta)));
    },
    [isDesktop, setPreview, defaultEditorPct],
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
  // Commenting needs the panel: when a comment starts and the panel is collapsed,
  // peek it open; close the peek once the comment is saved or cancelled.
  useEffect(() => {
    if (asideCollapsed) setAsidePeek(commentActive);
  }, [commentActive, asideCollapsed]);

  // Per-file UI settings (divider, view, follow-cursor, clean view, comments
  // collapsed): remember the layout each file was left in, and default a new
  // file to the most-recently-used layout. Keyed by the stable file id so it
  // survives re-imports. Theme and the autosave safety toggle stay global.
  const fileKey = docFileKey(drive, id);
  // Reverse sync: the editor cursor follows the deck's slide as you navigate it.
  // On by default; the RHS settings toggle turns it off.
  const [followSlide, setFollowSlide] = useState(true);
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
    if (typeof s.followSlide === "boolean") setFollowSlide(s.followSlide);
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
      saveDocSettings(fileKey, { editorPct, showPreview: previewToggled, followCursor, followSlide, cleanView, asideCollapsed });
    }, 200);
    return () => clearTimeout(t);
  }, [fileKey, editorPct, previewToggled, followCursor, followSlide, cleanView, asideCollapsed]);

  // Collaborative presence: broadcast the slide this user is on (the deck's
  // current slide when its preview is visible, otherwise the editor cursor's
  // slide) and read the peers, for the navbar avatars and the outline markers.
  const { peers, setLocalSlide } = usePresence(yjs.awareness);
  const [deckSlide, setDeckSlide] = useState<number | null>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number };
      if (d?.type === "mist-slide" && typeof d.h === "number") {
        setDeckSlide(d.h);
        followDeckInEditorRef.current(d.h);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const localSlide = useMemo(() => {
    if (!deck) return null;
    if ((splitOpen || slidesFull || present) && deckSlide != null) return deckSlide;
    return slideIndexForOffset(markdown, cursorOffset);
  }, [deck, splitOpen, slidesFull, present, deckSlide, markdown, cursorOffset]);
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
  // Move the editor cursor to a slide's source heading. `focus` says whether to
  // pull focus back to the editor. y:"start" puts the heading near the top of the
  // viewport, rather than scrollIntoView's default of the nearest edge.
  const moveCursorToSlide = (idx: number, focus: boolean) => {
    if (!editorView) return;
    const pos = Math.min(offsetForSlideIndex(markdown, idx), editorView.state.doc.length);
    editorView.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 48 }),
    });
    if (focus) editorView.focus();
  };

  // Manual reverse sync (the gutter button and Ctrl/Cmd+Alt+G): jump to AND edit
  // the slide currently shown in the preview (the deck reports it into ?slide).
  // Held in a ref so the shortcut handler does not rebuild on every keystroke.
  const syncEditorToSlideRef = useRef<() => void>(() => {});
  syncEditorToSlideRef.current = () => {
    const s = typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("slide") : null;
    moveCursorToSlide(s && /^\d+$/.test(s) ? Number(s) : 0, true);
  };

  // Automatic reverse sync: as the deck moves (its arrow keys, clicking a slide),
  // follow it in the editor too, WITHOUT stealing focus. Skipped while the editor
  // is focused, so typing (which drives the deck the other way) always wins and
  // the cursor is never yanked mid-edit: the editor is the higher-priority side.
  // Ref so the once-registered message listener reads the current markdown/editor.
  const followDeckInEditorRef = useRef<(idx: number) => void>(() => {});
  followDeckInEditorRef.current = (idx: number) => {
    if (!editorView || editorView.hasFocus || !followSlide) return;
    moveCursorToSlide(idx, false);
  };

  // Enter/exit Present. Fullscreen the whole app (best-effort), not the deck
  // iframe, so the presenter rail and exit control sit beside the slide. Esc (or
  // any fullscreen exit) drops back out via the fullscreenchange listener below.
  const enterPresent = useCallback(() => {
    setPresenting(true);
    setPresentStart(Date.now());
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  const exitPresent = useCallback(() => {
    setPresenting(false);
    if (typeof document !== "undefined" && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  // Leaving browser fullscreen (Esc, F11) leaves Present too, so the two never
  // disagree. Held in a ref so the chord handler stays stable.
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && presentingRef.current) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  // Print a deck via the standalone print-pdf page (the same route the navbar
  // "Print to PDF" uses), NEVER the live editing-preview: the browser crashes
  // printing the sandboxed reveal iframe. Open a new tab when there is a user
  // gesture (the parent key path); fall back to same-tab navigation when a popup
  // is refused (the iframe forwards via postMessage, which carries no gesture).
  const printDeck = useCallback(() => {
    if (!deck) return;
    const url =
      `/slides/${id}?k=${encodeURIComponent(docKey ?? "")}` +
      `&token=${encodeURIComponent(assetToken ?? "")}&print-pdf&combine-fragments`;
    const w = window.open(url, "_blank", "noopener");
    if (!w) window.location.assign(url);
  }, [deck, id, docKey, assetToken]);

  // Print a document. Open a throwaway tab synchronously (to survive popup
  // blockers), switch the editor to Preview so the rendered HTML is in the DOM,
  // grab it, restore the previous view, then hand the HTML to that tab where
  // Paged.js paginates and prints it. The gmist window is never mutated, so a
  // print or a cancel leaves nothing behind. If the popup is blocked, fall back
  // to a plain window.print() of the live preview. Decks use printDeck instead.
  const printDoc = useCallback(() => {
    if (deck) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Preparing PDF…</title>' +
          '<body style="font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#555">Preparing PDF…</body>',
      );
    }
    const prevView = viewRef.current;
    setView("preview");
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(".preview");
      if (el && el.textContent && el.textContent.trim()) {
        const html = el.innerHTML;
        if (prevView !== "preview") setView(prevView);
        if (win) fillPrintTab(win, html, title, frontmatter);
        else window.print(); // popup blocked: plain in-window fallback
      } else if (tries > 60) {
        if (prevView !== "preview") setView(prevView);
        win?.close();
      } else {
        tries++;
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, [deck, setView, title, frontmatter]);

  // The deck iframe forwards F (plain) as a present request and Ctrl/Cmd+P as a
  // print request, since the sandboxed iframe can neither fullscreen the app nor
  // open the print page itself.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const t = (e.data as { type?: string })?.type;
      if (t === "mist-present") enterPresent();
      else if (t === "mist-print") printDeck();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [enterPresent, printDeck]);

  // The Share menu's "Print to PDF" (a document) fires this; a deck uses its own
  // /slides print link in that menu instead.
  useEffect(() => {
    const onPrint = () => {
      if (!deck) printDoc();
    };
    window.addEventListener("mist-print-doc", onPrint);
    return () => window.removeEventListener("mist-print-doc", onPrint);
  }, [deck, printDoc]);

  // Ctrl/Cmd+P prints through gmist, not the raw app: a deck prints its slides,
  // a document switches to Preview and prints that. For a deck, focus inside the
  // iframe instead forwards mist-print (the runtime cannot open the print page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "p" || e.key === "P") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (deck) printDeck();
        else printDoc();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deck, printDeck, printDoc]);

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
        // P presents the deck (one mode: fullscreen app, chrome off, presenter rail).
        case "p": if (!deck) return false; if (presentingRef.current) exitPresent(); else enterPresent(); return true;
        // N toggles the presenter card (next slide + notes + timer) in Present.
        case "n": setRailOpen((v) => !v); return true;
        case "/": window.dispatchEvent(new CustomEvent("mist-toggle-help")); return true;
        default: return false;
      }
    },
    [toggleMode, setView, isDesktop, setAsideCollapsedPersist, asideCollapsed, nudgeSplit, deck, enterPresent, exitPresent],
  );

  // Ctrl/Cmd+S (and Ctrl/Cmd+Enter, dispatched by the editor) flushes a save to
  // the backend now and refreshes the deck preview. The deck rebuild is handled
  // in SlidesView; here we force the write so "save" actually saves.
  useEffect(() => {
    const onSave = () => saveNow();
    window.addEventListener("mist-rebuild-deck", onSave);
    return () => window.removeEventListener("mist-rebuild-deck", onSave);
  }, [saveNow]);

  useChordListener(runChord);

  const startDrag = useSplitDrag(contentRef, setEditorPct);

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
      <QuickOpenTrigger />
      {!present && (
      <header ref={headerRef} className="flex items-stretch border-b border-border">
        <Link
          to="/"
          className="flex shrink-0 items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          {APP_NAME}
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
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("mist-toggle-library"))}
          title="Insert a standard slide from the library (or type /library)"
          aria-label="Open the library"
          className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-border hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        {/* Present: fill the app (fullscreen), hide the chrome and show the
            presenter rail. One in-app mode, so the slide and our own UI share the
            screen. Ctrl/Cmd+Alt+P toggles it; Esc leaves. */}
        {deck && (
          <button
            type="button"
            onClick={enterPresent}
            title="Present (Ctrl/Cmd+Alt+P)"
            aria-label="Present deck"
            className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-border hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M10 8.5 14.5 11 10 13.5Z" fill="currentColor" stroke="none" />
            </svg>
          </button>
        )}
        {/* Print to PDF (documents only; a deck prints via Present/Ctrl+P).
            Paginates the preview with Paged.js into real A4 pages, then prints. */}
        {!deck && (
          <button
            type="button"
            onClick={printDoc}
            title="Print to PDF (Ctrl/Cmd+P)"
            aria-label="Print to PDF"
            className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-border hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" />
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
          <button
            type="button"
            onClick={() => setAsideCollapsedPersist(!asideCollapsed)}
            title="Comments panel (Ctrl/Cmd+Alt+C)"
            aria-label="Toggle comments panel"
            aria-pressed={!asideCollapsed}
            className={`hidden shrink-0 cursor-pointer items-center border-l border-border px-3 transition-colors lg:flex ${
              !asideCollapsed ? "bg-ink text-paper" : "hover:bg-border hover:text-ink"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>
      )}
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
        {present ? (
          <div className="relative h-full w-full overflow-hidden bg-black">
            <SlidesView />
            <button
              type="button"
              onClick={exitPresent}
              title="Exit present (Esc)"
              aria-label="Exit present"
              className="absolute right-3 top-3 z-50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
            {/* The slide list is still reachable in Present with Ctrl/Cmd+Alt+D. */}
            {outlineOpen && (
              <OutlinePanel
                view={editorView}
                text={markdown}
                deck={deck}
                canEdit={role === "edit"}
                peers={peers}
                currentSlide={localSlide}
                overlay
                onClose={() => setOutlineOpen(false)}
                onMouseLeave={() => setOutlineOpen(false)}
              />
            )}
            {railOpen || railPeek ? (
              <PresenterRail
                markdown={markdown}
                frontmatter={frontmatter}
                currentSlide={localSlide ?? 0}
                startedAt={presentStart}
                onMouseLeave={() => setRailPeek(false)}
              />
            ) : (
              // A right-edge target that reveals the presenter card on hover.
              <div
                onMouseEnter={() => setRailPeek(true)}
                title="Presenter info (Ctrl/Cmd+Alt+N)"
                className="absolute right-0 top-1/2 z-40 h-48 w-4 -translate-y-1/2"
              />
            )}
          </div>
        ) : (
        <>
        <div ref={contentRef} className="relative flex flex-1 overflow-hidden">
          {/* When the deck fills the pane (presenting), a thin left-edge zone
              peeks the slide list on hover; Ctrl/Cmd+Alt+D toggles it too. */}
          {slidesFull && !outlineOpen && (
            <div
              onMouseEnter={() => setOutlineOpen(true)}
              title="Slides (hover, or Ctrl/Cmd+Alt+D)"
              className="absolute inset-y-0 left-0 z-40 w-3 cursor-pointer bg-gradient-to-r from-border/70 to-transparent"
            />
          )}
          {outlineOpen && (
            <OutlinePanel
              view={editorView}
              text={markdown}
              deck={deck}
              canEdit={role === "edit"}
              peers={peers}
              currentSlide={localSlide}
              overlay={slidesFull}
              onClose={() => setOutlineOpen(false)}
              onMouseLeave={slidesFull ? () => setOutlineOpen(false) : undefined}
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
                lang={lang}
                onTextChange={setEditorText}
                onCursorChange={setCursor}
                onViewReady={handleViewReady}
                onUserEdit={markUserEdited}
                onImagePaste={drive ? uploadImage : undefined}
                onShortcut={runChord}
                className="min-h-full text-base"
              />
            </div>
            {/* Full-screen document preview stays inside main (it scrolls with
                the editor). A deck preview instead renders in the section below. */}
            {!splitOpen && showPreview && !deck && <Preview />}
          </main>
          {isDesktop && splitOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              title="Drag to resize editor and preview"
              className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-chartreuse"
            >
              {/* widen the grab target a few px into each pane */}
              <span className="absolute inset-y-0 -left-1 -right-1" />
              {deck ? (
                /* On a deck, a left-arrow on the divider moves the editor to the
                   slide shown on the right. stopPropagation so it does not start a
                   drag. Replaces the old navbar jump icon. */
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => syncEditorToSlideRef.current()}
                  title="Move the editor to the slide shown here (Ctrl/Cmd+Alt+G)"
                  aria-label="Jump editor to current slide"
                  className="absolute z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-paper text-muted shadow hover:text-ink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
              ) : (
                /* grip dots so the handle is findable */
                <span className="pointer-events-none flex flex-col gap-1 opacity-50 group-hover:opacity-90">
                  <span className="h-1 w-1 rounded-full bg-ink" />
                  <span className="h-1 w-1 rounded-full bg-ink" />
                  <span className="h-1 w-1 rounded-full bg-ink" />
                </span>
              )}
            </div>
          )}
          {(splitOpen || slidesFull) && (
            <section className="flex-1 overflow-hidden">
              {deck ? <SlidesView /> : <div ref={previewScrollRef} className="h-full overflow-y-auto"><Preview /></div>}
            </section>
          )}
        </div>
        {/* No collapsed strip: an invisible right-edge zone peeks the panel on
            hover (the navbar hamburger toggles it for good). */}
        {asideCollapsed && !asidePeek && (
          <div
            onMouseEnter={() => setAsidePeek(true)}
            aria-hidden
            className="absolute inset-y-0 right-0 z-40 hidden w-3 lg:block"
          />
        )}
        {(!asideCollapsed || asidePeek) && (
          <aside
            onMouseLeave={() => asidePeek && !commentActive && setAsidePeek(false)}
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
                {deck && (
                  <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-muted hover:text-ink">
                    <span title="When on, navigating the slide preview (its arrow keys, clicking a slide) moves the editor cursor to that slide. Skipped while you are typing, so the editor always wins.">
                      Follow slide in editor
                    </span>
                    <input
                      type="checkbox"
                      checked={followSlide}
                      onChange={(e) => setFollowSlide(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-coral"
                    />
                  </label>
                )}
              </div>
            )}
          </aside>
        )}
        </>
        )}
      </div>
      <MobilePanel className="lg:hidden" />
      <NamePrompt />
      <HelpPanel />
      <LibraryGallery />
    </div>
  );
}
