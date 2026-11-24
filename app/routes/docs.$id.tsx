import { data, redirect } from "react-router";
import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Route } from "./+types/docs.$id";
import { APP_NAME, isValidDocumentId } from "~/shared/constants";
import { isLocalFileId } from "~/lib/localfs-ids";
import { resolveDoc } from "~/lib/doc-resolve.server";
import type { DocRole, DriveMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { isLocalMode } from "~/lib/google.server";
import { mintDeckToken, authorizeDoc, type DriveSessionEnv } from "~/lib/drive-access.server";
import { EditorView } from "@codemirror/view";
import { useChords } from "~/lib/chord";
import { remember, remembered } from "~/lib/remembered";
import { extractOutlineFromText } from "~/lib/outline";
import { QuickOpenTrigger } from "~/components/QuickOpen";
import { useSplitDrag } from "~/lib/useSplitDrag";
import { deckIndexForOffset, deckSlideTarget, offsetForDeckIndex } from "~/lib/slide-cursor";
import { docFileKey, loadDocSettings, saveDocSettings } from "~/lib/doc-settings";
import { resolveAssetSrc } from "~/lib/asset-urls";
import { usePresence } from "~/lib/usePresence";
import { useFreshAssetToken } from "~/lib/useFreshAssetToken";
import PresenceBar from "~/components/PresenceBar";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import CodeMirrorEditor from "~/components/CodeMirrorEditor";
import Preview from "~/components/Preview";
import ConnectionStatus from "~/components/ConnectionStatus";
import UserName from "~/components/UserName";
import SaveStatus from "~/components/SaveStatus";
import ShareButton, { deckPdfLink, docPdfLink } from "~/components/ShareButton";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionList from "~/components/SuggestionList";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import MobilePanel from "~/components/MobilePanel";
import NamePrompt from "~/components/NamePrompt";
import FolderSidebar from "~/components/FolderSidebar";
import OutlinePanel from "~/components/OutlinePanel";
import PresentLayer from "~/components/PresentLayer";
import SplitGutter from "~/components/SplitGutter";
import { usePresent } from "~/lib/usePresent";
import HelpPanel from "~/components/HelpPanel";
import LibraryGallery from "~/components/LibraryGallery";
import DocGate from "~/components/DocGate";
import ShareOnOpen from "~/components/ShareOnOpen";
import RememberRoom from "~/components/RememberRoom";
import SlidesView, { isSlideDeck } from "~/components/SlidesView";
import { VIEW_BUTTONS, type DocView } from "~/components/Toolbar";
import DocNavbar from "~/components/DocNavbar";
import { deckSlideLayout, fileTitle } from "~/lib/slides-build";

// useLayoutEffect on the client (so scroll is restored before paint, no flash),
// useEffect on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function meta({ data }: Route.MetaArgs) {
  const drive = data && "drive" in data ? data.drive : null;
  const title = drive ? fileTitle(drive, APP_NAME) : APP_NAME;
  return [{ title: title || APP_NAME }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  // A local file belongs to the plain editor, which is where /open sends every
  // one of them. This route stays reachable for a local id only through an old
  // link, a bookmark or a restored tab, so it forwards rather than opening a
  // second editor over the same file. One editor per file is not a preference:
  // two of them were two buffers, two save machines and two copies of every
  // rule about a file, and the rules kept being fixed in one and not the other.
  if (isLocalFileId(id)) throw redirect(`/edit/${encodeURIComponent(id)}`);
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const docKey = searchParams.get("k");
  const initialPreview = searchParams.get("view") === "preview";
  // Decided here, not from `window` on the client, so the server renders the
  // same View pill the client will and hydration matches.
  const initialLive = searchParams.get("view") === "live";
  const { env } = getCloudflare(context);
  const { exists, createdAt, role, suggestKey, drive, sharing } = await resolveDoc(env, id, docKey);

  if (!exists || !role) {
    throw data(null, { status: 404 });
  }

  // The secret link is NOT sufficient: a Drive-bound doc also requires the
  // file's Drive sharing to grant the viewer, a signed-in user it is shared
  // with or, without sign-in, anyone-with-link (Drive sharing is the source of
  // truth). The same check gates the WebSocket in workers/app.ts. The effective
  // role is the more restrictive of the link's role and the viewer's Drive role.
  const auth = await authorizeDoc(env as unknown as DriveSessionEnv, request, drive, role, sharing);
  if (auth.status === "badkey") throw data(null, { status: 404 });
  if (auth.status === "needsAuth") return { id, gate: "needsAuth" as const };
  if (auth.status === "forbidden") return { id, gate: "forbidden" as const };
  const effectiveRole = auth.role ?? role;

  // Short-lived deck token so the sandboxed slides iframe, which cannot send the
  // session cookie, can fetch this file's private-Drive css and images. It is
  // minted for the viewer who just passed authorizeDoc, and admits only this
  // file's assets and library images. An unbound room has no file, so no token.
  const assetToken = await mintDeckToken(env as unknown as DriveSessionEnv, drive?.fileId, auth.viewer);

  return {
    id,
    createdAt,
    role: effectiveRole,
    suggestKey: effectiveRole === "edit" ? suggestKey ?? null : null,
    docKey,
    drive,
    initialPreview,
    initialLive,
    assetToken,
    // Storage mode, so the UI can name the target ("file" locally, "Drive" on
    // the deployed worker) instead of always saying Drive.
    local: isLocalMode(env),
    gate: null,
  };
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
  initialLive: boolean;
  assetToken: string | null;
  local: boolean;
  gate: null;
};

/** The reader's own choice for the document outline, per browser. */
const DOC_OUTLINE_KEY = "gmist.doc.outline";
/** Headings a document needs before its outline opens unasked. */
const OUTLINE_MIN_HEADINGS = 3;

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

/** Every document this route opens is a room. A local file is a file, and the
 *  loader forwards it to the plain editor before it reaches here. */
function DocumentRoot(props: EditorData) {
  return <DocumentShell {...props} yjs={useYjsEditor(props.id, props.docKey)} />;
}

function DocumentShell({
  id,
  createdAt,
  role,
  suggestKey,
  docKey,
  drive,
  initialPreview,
  initialLive,
  assetToken,
  local,
  yjs,
}: EditorData & { yjs: ReturnType<typeof useYjsEditor> }) {
  const freshAssetToken = useFreshAssetToken(assetToken, drive?.fileId);
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
      assetToken={freshAssetToken}
    >
      <DocumentLayout id={id} local={local} initialLive={initialLive} />
      <ShareOnOpen />
      <RememberRoom />
    </DocumentProvider>
  );
}

function DocumentLayout({ id, local, initialLive }: { id: string; local: boolean; initialLive: boolean }) {
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
    unsaved,
    backed,
    autoSave,
    setAutoSave,
    followCursor,
    setFollowCursor,
    setCleanView,
    commentActive,
    openSlideComment,
    threads,
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
  // A document long enough to have an outline opens with it showing, on a
  // screen wide enough to spare the column. The reader's own toggle is then
  // remembered and wins on every later open. Decided once, when the text first
  // arrives; a deck's slide list stays closed until asked for.
  const outlineDecided = useRef(false);
  useEffect(() => {
    if (outlineDecided.current || !markdown) return;
    outlineDecided.current = true;
    if (deck) return;
    const choice = remembered(DOC_OUTLINE_KEY, ["yes", "no", "unset"] as const, "unset");
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const open =
      choice === "unset"
        ? wide && extractOutlineFromText(markdown).length >= OUTLINE_MIN_HEADINGS
        : choice === "yes" && wide;
    if (open) setOutlineOpen(true);
  }, [markdown, deck]);
  const toggleOutline = useCallback(() => {
    setOutlineOpen((v) => {
      if (!deck) remember(DOC_OUTLINE_KEY, v ? "no" : "yes");
      return !v;
    });
  }, [deck]);
  // Present mode: the deck fills the window, chrome hidden, and the notes get a
  // floating window of their own (usePresent, shared with the local editor).
  const presentMode = usePresent(deck);
  const presenting = presentMode.presenting;
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
  const openCommentPositions = useMemo(
    () => threads.filter((t) => !t.resolved && t.position != null).map((t) => t.position!),
    [threads],
  );
  const slideProps = {
    markdown,
    drive,
    frontmatter,
    cursorOffset,
    assetToken,
    followCursor,
    bibLib,
  };

  // The View is one of four exclusive layouts. It is derived from the preview
  // toggle, the split ratio and the live flag, and setView drives all three, so
  // the navbar, keyboard and URL all speak the same four-state language. Live is
  // an editor-only View with the markdown syntax marks hidden away from the
  // cursor, so it sits between Editor and Split.
  const [livePreview, setLivePreview] = useState(initialLive);
  const view: DocView = splitOpen ? "split" : showPreview ? "preview" : livePreview ? "live" : "editor";
  const setView = useCallback(
    (v: DocView) => {
      setLivePreview(v === "live");
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

  // Live preview's inline images resolve exactly as the Preview pane's do,
  // through the asset proxy, so the same picture shows in both.
  const resolveEditorSrc = useCallback(
    (src: string) =>
      resolveAssetSrc(src, {
        drive,
        origin: typeof window !== "undefined" ? window.location.origin : "",
        driveToken: drive ? assetToken ?? "" : "",
      }),
    [drive, assetToken],
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
  // Replying to a comment from the editor toolbar pins the panel open (not a
  // peek), so it stays put while the reply is typed.
  useEffect(() => {
    const onReply = () => setAsideCollapsedPersist(false);
    window.addEventListener("mist-reply", onReply);
    return () => window.removeEventListener("mist-reply", onReply);
  }, [setAsideCollapsedPersist]);

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
      // Live is the default View for a file with nothing saved.
      setLivePreview(typeof s.livePreview === "boolean" ? s.livePreview : true);
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
      saveDocSettings(fileKey, { editorPct, showPreview: previewToggled, livePreview, followCursor, followSlide, cleanView, asideCollapsed });
    }, 200);
    return () => clearTimeout(t);
  }, [fileKey, editorPct, previewToggled, livePreview, followCursor, followSlide, cleanView, asideCollapsed]);

  // A comment (suggest) link to a deck that names no view opens on the deck:
  // Preview, with the comments panel and Comment on slide, whatever layout this
  // browser last used, since a reviewer is there to read the slides. Decided
  // once, when the synced text shows whether it is a deck. A link that names a
  // view keeps it, and the URL then carries Preview, so a reload keeps
  // whatever the reviewer picks next.
  const reviewDeckOnOpen = useRef(
    role === "suggest" && typeof window !== "undefined" && !new URL(window.location.href).searchParams.has("view"),
  );
  useEffect(() => {
    if (!reviewDeckOnOpen.current || !yjs.synced) return;
    reviewDeckOnOpen.current = false;
    // The Y.Text itself, which holds the synced content before the editor has
    // passed it on to `markdown`.
    if (deck || isSlideDeck(yjs.doc.getText("body").toString())) setView("preview");
  }, [deck, yjs.synced, yjs.doc, setView]);

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
  // Every index here is the deck's (hidden slides not counted): what the deck
  // reports, what peers jump to and what the outline marks.
  const slideLayout = useMemo(() => (deck ? deckSlideLayout(markdown) : null), [deck, markdown]);
  const localSlide = useMemo(() => {
    if (!slideLayout) return null;
    if ((splitOpen || slidesFull || present) && deckSlide != null) return deckSlide;
    return deckIndexForOffset(markdown, cursorOffset, slideLayout);
  }, [slideLayout, splitOpen, slidesFull, present, deckSlide, markdown, cursorOffset]);
  // Present has no comments panel and no button over the deck: its controls
  // carry Comment, for the slide the deck reports, and the input floats over it.
  const presentTarget = useMemo(
    () => (present && slideLayout ? deckSlideTarget(markdown, localSlide ?? 0, slideLayout) : null),
    [present, slideLayout, localSlide, markdown],
  );
  const presentComments = presentTarget
    ? openCommentPositions.filter((p) => p >= presentTarget.start && p < presentTarget.end).length
    : 0;
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

  // Move the editor cursor to a slide's source heading. `focus` says whether to
  // pull focus back to the editor. y:"start" puts the heading near the top of the
  // viewport, rather than scrollIntoView's default of the nearest edge.
  const moveCursorToSlide = (idx: number, focus: boolean) => {
    if (!editorView) return;
    const pos = Math.min(offsetForDeckIndex(markdown, idx, slideLayout ?? undefined) ?? markdown.length, editorView.state.doc.length);
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

  // Print as a PDF made on the server (the same link as the Share menu's "Print
  // to PDF"): a deck from its /slides print page, a document from its /print
  // page. NEVER the live editing preview: the browser crashes printing the
  // sandboxed reveal iframe, and the app around a document is not a page. Unsaved
  // edits are sent first, so the file the server reads is the one on screen.
  // Opens a new tab when there is a user gesture (the parent key path) and falls
  // back to same-tab navigation when a popup is refused (the iframe forwards via
  // postMessage, which carries no gesture). Not "noopener": that makes
  // window.open return null even when the tab opened, which read as refused and
  // navigated this tab away as well.
  const printPdf = useCallback(() => {
    if (unsaved) saveNow();
    const url = deck ? deckPdfLink(id, docKey) : docPdfLink(id, docKey);
    const w = window.open(url, "_blank");
    if (w) w.opener = null;
    else window.location.assign(url);
  }, [unsaved, saveNow, deck, id, docKey]);

  // The deck iframe forwards Ctrl/Cmd+P as a print request, since the sandboxed
  // iframe cannot open the print page itself. (Its F and Esc go to usePresent.)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "mist-print") printPdf();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [printPdf]);

  // Ctrl/Cmd+P prints through gmist, not the raw app. For a deck, focus inside
  // the iframe instead forwards mist-print (the runtime cannot open the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "p" || e.key === "P") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        printPdf();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [printPdf]);

  // This editor's Ctrl/Cmd+Alt chords, in the one chord registry (app/lib/chord.ts),
  // which the window, the editor and the deck's iframe all feed, and which the
  // Help panel lists. Panels that own their open state register their own: F the
  // folder sidebar, J quick open, M the comment box, / the Help panel.
  useChords([
    // S toggles the binary edit/suggest mode (a no-op for suggest-only links).
    { key: "s", label: "Switch between editing and suggesting", group: "view", run: toggleMode },
    ...VIEW_BUTTONS.filter((b) => b.view !== "split" || isDesktop).map((b) => ({
      key: b.chord,
      label: b.label,
      group: "view" as const,
      run: () => setView(b.view),
    })),
    // Present is for decks: one mode, chrome off, notes in a window of their own.
    ...(deck
      ? [
          {
            key: "p",
            label: "Present: the deck fills the window, notes in a floating window",
            group: "view" as const,
            run: () => (presentMode.presenting ? presentMode.exit() : presentMode.enter()),
          },
          {
            key: "n",
            label: "Present: speaker notes window (notes, next slide, timer)",
            group: "view" as const,
            run: () => presentMode.presenting && presentMode.toggleNotes(),
          },
        ]
      : []),
    // Resize on - / = (not [ / ], which CodeMirror uses for fold-all).
    { key: "-", label: "Shrink the editor pane (split view)", group: "view", run: () => nudgeSplit(-5) },
    { key: "=", label: "Grow the editor pane (split view)", group: "view", run: () => nudgeSplit(5) },
    { key: "d", label: "Outline / slide list", group: "panels", run: toggleOutline },
    { key: "c", label: "Comments panel", group: "panels", run: () => setAsideCollapsedPersist(!asideCollapsed) },
    ...(deck
      ? [{ key: "g", label: "Editor to the shown slide (or the divider arrow)", group: "panels" as const, run: () => syncEditorToSlideRef.current() }]
      : []),
  ]);

  // Ctrl/Cmd+S (and Ctrl/Cmd+Enter, dispatched by the editor) flushes a save to
  // the backend now and refreshes the deck preview. The deck rebuild is handled
  // in SlidesView; here we force the write so "save" actually saves.
  useEffect(() => {
    const onSave = () => saveNow();
    window.addEventListener("mist-rebuild-deck", onSave);
    return () => window.removeEventListener("mist-rebuild-deck", onSave);
  }, [saveNow]);

  const startDrag = useSplitDrag(contentRef, setEditorPct);

  // The editor and Preview share this scroll container, so swapping between
  // them would otherwise jump to the top. Track the scroll fraction and restore
  // it when the view flips, re-applying as Preview's content settles (it mounts
  // empty then fills in, which changes the scroll height).
  const mainRef = useRef<HTMLElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const asideScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const scrollFraction = useRef(0);
  const restoring = useRef(false);

  /** Scroll the comments pane so the first card at or after `pos` is at its top. */
  const syncAside = useCallback((pos: number) => {
    const aside = asideScrollRef.current;
    if (!aside) return;
    const cards = Array.from(aside.querySelectorAll<HTMLElement>("[data-pos]"));
    if (!cards.length) return;
    // Above the first card there is nothing to follow, so show the pane's own head
    // (the Accept all / Reject all row, the comment input) rather than scrolling it
    // out of reach.
    if (pos <= Number(cards[0].dataset.pos)) {
      aside.scrollTop = 0;
      return;
    }
    const next = cards.find((c) => Number(c.dataset.pos) >= pos);
    const target = next
      ? next.getBoundingClientRect().top - aside.getBoundingClientRect().top + aside.scrollTop - 8
      : aside.scrollHeight;
    aside.scrollTop = Math.max(0, Math.min(target, aside.scrollHeight - aside.clientHeight));
  }, []);

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

  // Scroll sync across the three panes (editor, preview, comments).
  //
  // ONE shared coordinate: the source character offset. Whichever pane the user
  // scrolls, gmist reads the offset at the TOP of that pane and puts the same
  // offset at the top of the others, so "scroll to X" means X is at the top
  // everywhere.
  //
  // Nothing here uses editor PIXELS away from the viewport, and that is the point:
  // CodeMirror renders only the lines near the viewport and merely ESTIMATES the
  // height of the rest (a wrapped paragraph is guessed at one line), so any y it
  // reports for a line further down is far too small. Pixels are read only where
  // they are real (the preview, fully laid out; the editor's own viewport top),
  // and the reverse direction hands the position to CodeMirror's scrollIntoView,
  // which measures it properly itself.
  //
  // The offset <-> preview-pixel map comes from the anchors Preview emits: one
  // hidden marker per BLOCK, not per heading (see app/lib/source-anchors.ts). With
  // heading anchors the position inside a section was a character fraction, and a
  // section holding an image, a table or a code block is tall on the page and short
  // in characters, which is what left the two panes hundreds of pixels apart.
  //
  // Proportional scroll is the fallback when there are no anchors at all.
  // A flag breaks the feedback loop between the listeners.
  useEffect(() => {
    if (!splitOpen || slidesMode) return;
    const ed = mainRef.current;
    const pv = previewScrollRef.current;
    const view = editorView;
    if (!ed || !pv || !view) return;

    const offsetIn = (el: Element, container: HTMLElement) =>
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

    // Rebuilding the map means a rect per block, so it is cached and thrown away
    // whenever the preview's height changes (an edit, an image or a diagram
    // landing) or the document's length does.
    let cache: { pts: { pos: number; y: number }[] | null; h: number; len: number } | null = null;

    /** Block anchors: source offset <-> preview y. Bracketed by both extremes. */
    const anchors = (): { pos: number; y: number }[] | null => {
      const len = view.state.doc.length;
      if (cache && cache.h === pv.scrollHeight && cache.len === len) return cache.pts;

      const pts: { pos: number; y: number }[] = [{ pos: 0, y: 0 }];
      for (const marker of Array.from(pv.querySelectorAll<HTMLElement>("br[data-pos]"))) {
        const block = marker.nextElementSibling;
        if (!block) continue;
        const pos = Number(marker.dataset.pos);
        const y = offsetIn(block, pv);
        const last = pts[pts.length - 1];
        // Both axes must increase together or the interpolation is nonsense; a
        // column layout, where two blocks share a y, is the case that breaks it.
        if (!Number.isFinite(pos) || pos <= last.pos || y < last.y) continue;
        pts.push({ pos, y });
      }
      pts.push({ pos: len, y: pv.scrollHeight });
      const result = pts.length > 2 ? pts : null;
      cache = { pts: result, h: pv.scrollHeight, len };
      return result;
    };

    /** Interpolate x through the anchors, in either direction. */
    const map = (
      x: number,
      pts: { pos: number; y: number }[],
      from: "pos" | "y",
      to: "pos" | "y",
    ): number => {
      for (let i = pts.length - 1; i >= 0; i--) {
        if (x >= pts[i][from]) {
          const next = pts[i + 1];
          if (!next) return pts[i][to];
          const span = next[from] - pts[i][from] || 1;
          const frac = Math.max(0, Math.min(1, (x - pts[i][from]) / span));
          return pts[i][to] + frac * (next[to] - pts[i][to]);
        }
      }
      return pts[0][to];
    };

    const proportional = (from: HTMLElement, to: HTMLElement) => {
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      return fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
    };

    const hold = () => {
      syncingScroll.current = true;
      // CodeMirror's scrollIntoView lands on a later frame, so hold the guard past
      // the scroll it causes, or the two panes chase each other.
      setTimeout(() => {
        syncingScroll.current = false;
      }, 120);
    };

    /** The source position at the top of the editor viewport. */
    const editorTop = () => {
      const rect = ed.getBoundingClientRect();
      return view.posAtCoords({ x: rect.left + 24, y: rect.top + 1 }, false);
    };

    // Editor -> preview: the source position at the top of the editor viewport.
    const onEd = () => {
      if (syncingScroll.current) return;
      hold();
      const pts = anchors();
      const toMax = pv.scrollHeight - pv.clientHeight;
      const pos = editorTop();
      const target = pts ? map(pos, pts, "pos", "y") : proportional(ed, pv);
      pv.scrollTop = Math.max(0, Math.min(target, toMax));
      syncAside(pos);
    };

    // Preview -> editor: the source position for the top of the preview viewport,
    // scrolled to by CodeMirror (which can measure a line it has not rendered).
    const onPv = () => {
      if (syncingScroll.current) return;
      hold();
      const pts = anchors();
      if (!pts) {
        ed.scrollTop = proportional(pv, ed);
        return;
      }
      const pos = Math.round(map(pv.scrollTop, pts, "y", "pos"));
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.max(0, Math.min(pos, view.state.doc.length)), {
          y: "start",
        }),
      });
      syncAside(pos);
    };

    ed.addEventListener("scroll", onEd);
    pv.addEventListener("scroll", onPv);
    return () => {
      ed.removeEventListener("scroll", onEd);
      pv.removeEventListener("scroll", onPv);
    };
  }, [splitOpen, slidesMode, editorView, syncAside]);

  // The comments pane is the third panel. It follows the document rather than
  // driving it (a review reads the text and looks aside at the notes on it, not
  // the other way round), so scrolling the editor or the preview brings the cards
  // for what is at the top of the page to the top of the list. Each card carries
  // its own source offset in `data-pos`. Clicking a card still jumps the editor to
  // it, which is the reverse direction, done deliberately.
  useEffect(() => {
    const ed = mainRef.current;
    const view = editorView;
    if (!ed || !view || splitOpen) return; // in split view the effect above drives it
    const onEd = () => {
      const rect = ed.getBoundingClientRect();
      syncAside(view.posAtCoords({ x: rect.left + 24, y: rect.top + 1 }, false));
    };
    ed.addEventListener("scroll", onEd);
    return () => ed.removeEventListener("scroll", onEd);
  }, [splitOpen, editorView, syncAside]);

  return (
    // h-screen + overflow-hidden pins the editor to exactly the viewport: this is
    // a fixed-frame app whose own regions (editor, preview, aside) scroll
    // internally, so the body must never scroll. Without the clip, any descendant
    // a few px past the edge (a deck preview's letterbox rounding, a wide navbar)
    // gives the whole page a stray x/y scrollbar.
    <div className="flex h-screen flex-col overflow-hidden">
      <QuickOpenTrigger />
      {!present && (
      <DocNavbar
        headerRef={headerRef}
        homeHref="/"
        folderButton={<FolderSidebar />}
        outline={{ open: outlineOpen, onToggle: toggleOutline }}
        deck={deck}
        folder={
          folderName
            ? { label: folderName, onClick: () => window.dispatchEvent(new CustomEvent("mist-toggle-folder")) }
            : null
        }
        title={title}
        status={
          <>
            <ConnectionStatus />
            <SaveStatus />
          </>
        }
        mode={{ value: mode, onToggle: () => role === "edit" && toggleMode(), locked: role !== "edit" }}
        view={{ value: view, onChange: setView, allowSplit: isDesktop }}
        onPresent={deck ? presentMode.enter : undefined}
        share={<ShareButton />}
        menu={[
          { label: "Print to PDF", keys: "Ctrl+P", onSelect: printPdf },
          {
            label: "Insert from the library",
            keys: "/library",
            title: "A standard slide or image from the shared library",
            onSelect: () => window.dispatchEvent(new CustomEvent("mist-toggle-library")),
          },
        ]}
        people={
          <>
            {peers.length > 0 && (
              <div className="flex items-center px-2">
                <PresenceBar peers={peers} />
              </div>
            )}
            <UserName />
          </>
        }
        comments={{
          open: !asideCollapsed,
          peek: asidePeek,
          onToggle: () => setAsideCollapsedPersist(!asideCollapsed),
        }}
      />
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
          <PresentLayer
            present={presentMode}
            markdown={markdown}
            frontmatter={frontmatter}
            currentSlide={localSlide ?? 0}
            slidesOpen={outlineOpen}
            onToggleSlides={() => setOutlineOpen((v) => !v)}
            className="relative h-full w-full overflow-hidden bg-black"
            onComment={presentTarget ? () => openSlideComment(presentTarget.start, presentTarget.label) : undefined}
            commentCount={presentComments}
          >
            <SlidesView {...slideProps} />
            {commentActive && (
              <div className="absolute right-3 top-14 z-50 w-96 max-w-[calc(100%-1.5rem)] border border-border bg-paper">
                <CommentInput />
              </div>
            )}
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
          </PresentLayer>
        ) : (
        <>
        <div className="relative flex flex-1 overflow-hidden">
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
              onClose={outlineOpen ? toggleOutline : () => {}}
              onMouseLeave={slidesFull ? () => setOutlineOpen(false) : undefined}
            />
          )}
          {/* The editor/preview split is measured in this box alone, so the
              outline beside it does not offset the divider from the pointer. */}
          <div ref={contentRef} className="flex min-w-0 flex-1 overflow-hidden">
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
            <div className={`min-h-full ${(splitOpen ? false : showPreview) ? "hidden" : "flex flex-col"}`}>
              <CodeMirrorEditor
                doc={yjs.doc}
                awareness={yjs.awareness}
                mode={mode}
                canEdit={role === "edit"}
                cleanView={cleanView}
                live={view === "live"}
                resolveSrc={resolveEditorSrc}
                activeComment={activeCommentRange}
                bibLibrary={bibLib}
                classList={cssClasses}
                lang={lang}
                onTextChange={setEditorText}
                onCursorChange={setCursor}
                onViewReady={handleViewReady}
                onUserEdit={markUserEdited}
                onImagePaste={drive ? uploadImage : undefined}
                className="flex flex-1 flex-col text-base"
              />
            </div>
            {/* Full-screen document preview stays inside main (it scrolls with
                the editor). A deck preview instead renders in the section below. */}
            {!splitOpen && showPreview && !deck && <Preview />}
          </main>
          {isDesktop && splitOpen && (
            <SplitGutter onMouseDown={startDrag}>
              {deck && (
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
              )}
            </SplitGutter>
          )}
          {(splitOpen || slidesFull) && (
            <section className="flex-1 overflow-hidden">
              {/* Comment on slide over the deck is offered here (Split and Preview), on a
                  screen wide enough for the comments panel it opens. */}
              {deck ? (
                <SlidesView
                  {...slideProps}
                  onCommentSlide={isDesktop ? openSlideComment : undefined}
                  commentPositions={openCommentPositions}
                />
              ) : (
                <div ref={previewScrollRef} className="h-full overflow-y-auto"><Preview /></div>
              )}
            </section>
          )}
          </div>
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
            <div ref={asideScrollRef} className="flex-1 overflow-y-auto">
              <SuggestionList />
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
                    <span title={`When off, edits do not write to the ${local ? "file" : "Drive file"} automatically. Manual save (Ctrl/Cmd+S or the Saving badge) still works.`}>
                      {local ? "Autosave to file" : "Autosave to Drive"}
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
