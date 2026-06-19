import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { CapturedSelection, DocMode, DocRole, DriveMeta } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { useYjsEditor } from "~/lib/useYjsEditor";
import { useTextThreads } from "~/lib/useTextThreads";
import { serializeThreads, rawFrontmatter } from "~/lib/thread-serialization";
import { quickHash } from "~/shared/hash";
import { driveAssetUrl } from "~/lib/asset-urls";
import { extractCssPaths, extractBibPaths } from "~/lib/slides-build";
import { parseCssClasses } from "~/lib/cm-classes";
import { parseBib, type BibLibrary } from "~/lib/citations";
import DECK_BASE_CSS from "~/styles/deck-base.css?raw";

// The house framework classes are always available to the `.` picker, even on a
// document with no deck `css:`, since gmist applies deck-base.css by default.
const DEFAULT_CLASSES = parseCssClasses(DECK_BASE_CSS);

export interface DocumentContextValue {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  /** The CodeMirror view backing the editor (Y.Text core). */
  view: EditorView | null;
  markdown: string;
  /** Editor cursor offset, for cursor-driven slide-preview sync. */
  cursorOffset: number;
  setCursor: (offset: number) => void;
  /** The document's own YAML frontmatter (theme, css, format...), held in the
   *  doc so it survives import and round-trips on commit-back. "" if none. */
  frontmatter: string;

  // Access role from the secret link; suggest-role users can never edit
  role: DocRole;
  docKey: string | null;
  suggestKey: string | null;

  // Google Drive source, if this doc was opened from Drive
  drive: DriveMeta | null;
  /** True when the doc is bound to a Drive backend and writes back */
  backed: boolean;
  /** Force an immediate write of the doc back to Drive */
  saveNow: () => void;
  /** Whether edits auto-save to the backend. A user toggle (persisted) for
   *  diagnosing sync issues; manual save (Ctrl+S / the badge) always works. */
  autoSave: boolean;
  setAutoSave: (on: boolean) => void;
  /** Whether the slide preview follows the editor cursor (a perf toggle for big
   *  decks). */
  followCursor: boolean;
  setFollowCursor: (on: boolean) => void;
  /** True when the document has edits not yet written back to its backend */
  unsaved: boolean;
  /** True when the backend rejected a write because the file changed upstream */
  conflict: boolean;
  /** True when the backend file changed upstream and the body also has local
   *  edits, so the user must choose to reload (taking the Drive version). */
  upstreamChanged: boolean;
  /** Pull the current Drive version into the editor, discarding local edits. */
  reloadFromDrive: () => void;
  /** Set when a divergent Drive version was preserved as a sibling file (the
   *  relay forked it so nothing was lost); holds the new file name briefly. */
  forkedNotice: string | null;
  /** Dismiss the forked-copy notice. */
  clearForkedNotice: () => void;
  /** Parsed BibTeX library for citation rendering, if found in the repo */
  bibLib: BibLibrary | null;
  /** Class names from the deck's CSS, for the editor's `.`-class picker. */
  cssClasses: string[];
  /** Short-lived token for fetching private-Drive assets (slides + preview). */
  assetToken: string | null;
  /** Upload a pasted image into the doc's Drive folder; resolves to the markdown
   *  path to reference, or null if not a Drive doc / the upload failed. */
  uploadImage: (file: File) => Promise<string | null>;

  // Mode
  mode: DocMode;
  toggleMode: () => void;

  // Preview
  showPreview: boolean;
  /** The persistent preview toggle, without the transient hover-peek; this is
   *  what the per-file layout remembers. */
  previewToggled: boolean;
  togglePreview: () => void;
  setPreview: (show: boolean) => void;
  setPreviewHeld: (held: boolean) => void;

  // Clean view
  cleanView: boolean;
  toggleCleanView: () => void;
  setCleanView: (on: boolean) => void;

  // Comments
  commentActive: boolean;
  commentSelection: CapturedSelection | null;
  commentHighlight: { from: number; to: number } | null;
  openCommentInput: () => void;
  handleCommentActiveChange: (active: boolean) => void;
  /** Insert a comment (on the captured selection, or a point at the cursor). */
  insertComment: (text: string) => void;
  handleResolveAtCursor: () => void;
  handleDeleteAtCursor: () => void;

  // Threads
  threads: MatchedThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  /** Bumped to ask a thread's panel to open its reply input (editor "Reply"). */
  replySignal: { id: string; n: number } | null;
  activeCommentRange: { from: number; to: number } | null;
  addReply: (threadId: string, text: string) => void;
  resolveThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;

  // Onboarding
  isOnboarding: boolean;
  clearDocument: () => void;

  // Editor lifecycle
  handleViewReady: (view: EditorView | null) => void;
  setEditorText: (text: string) => void;
  /** Mark that the user themselves edited, so the save baseline freezes (called by
   *  the editor on a userEvent transaction and by the comment/thread actions). */
  markUserEdited: () => void;
  handleCommentClick: (commentText: string) => void;
}

/** Idle delay before a live save flushes to the backend. */
const AUTOSAVE_DEBOUNCE_MS = 2500;

// Named _DocumentContext so test helpers can provide mock values directly
export const _DocumentContext = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const ctx = useContext(_DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a DocumentProvider");
  }
  return ctx;
}

export function DocumentProvider({
  docId,
  createdAt,
  yjs,
  role = "edit",
  docKey = null,
  suggestKey = null,
  drive = null,
  initialPreview = false,
  assetToken = null,
  children,
}: {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  role?: DocRole;
  docKey?: string | null;
  suggestKey?: string | null;
  drive?: DriveMeta | null;
  initialPreview?: boolean;
  assetToken?: string | null;
  children: React.ReactNode;
}) {
  // A Drive backend means edits are relayed for write-back to the source file.
  const backed = !!drive;
  const [markdown, setMarkdown] = useState("");
  const [view, setView] = useState<EditorView | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);
  // Throttle cursor-offset state: every cursor move re-renders the document tree
  // and re-derives the slide it sits in, which is heavy on a large deck. Coalesce
  // to ~10/sec (trailing) so the editor stays responsive; the slide-follow lags
  // imperceptibly. The editor's own cursor is unaffected (this is only the React
  // mirror that downstream views read).
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCursor = useRef(0);
  const setCursor = useCallback((o: number) => {
    pendingCursor.current = o;
    if (cursorTimer.current != null) return;
    cursorTimer.current = setTimeout(() => {
      cursorTimer.current = null;
      setCursorOffset(pendingCursor.current);
    }, 90);
  }, []);

  // The editor body now carries the file's own YAML frontmatter (the Y.Text
  // core makes that safe), so derive it from the markdown. Fall back to the
  // legacy Yjs "meta" map for rooms created before this unification, so their
  // frontmatter still round-trips on save.
  const [metaFrontmatter, setMetaFrontmatter] = useState("");
  useEffect(() => {
    const meta = yjs.doc.getMap<string>("meta");
    const read = () => setMetaFrontmatter((meta.get("frontmatter") as string) ?? "");
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [yjs.doc]);
  const frontmatter = useMemo(
    () => rawFrontmatter(markdown) || metaFrontmatter,
    [markdown, metaFrontmatter],
  );
  const [previewToggled, setPreviewToggled] = useState(initialPreview);
  const [previewHeld, setPreviewHeld] = useState(false);
  const [commentActive, setCommentActive] = useState(false);
  const [commentSelection, setCommentSelection] = useState<CapturedSelection | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<{ from: number; to: number } | null>(null);
  const [cleanView, setCleanView] = useState(true);
  // Bumped when the editor toolbar asks to reply to a thread; ThreadList passes
  // the count to the matching panel, which opens its reply input on a change.
  const [replySignal, setReplySignal] = useState<{ id: string; n: number } | null>(null);

  const showPreview = previewToggled || previewHeld;

  const {
    threads,
    createComment,
    addReply,
    resolveThread,
    deleteThread,
    resolveAtCursor,
    deleteAtCursor,
    activeThreadId,
    setActiveThreadId,
    activeRange,
  } = useTextThreads({ doc: yjs.doc, view, text: markdown, user: yjs.user });

  const toggleMode = useCallback(() => {
    if (role !== "edit") return;
    yjs.setMode(yjs.mode === "edit" ? "suggest" : "edit");
  }, [yjs, role]);

  // Relay the serialized document to the agent for Drive-backed docs. The agent
  // writes back to Drive on an explicit save (commitNow).
  const sendDoc = useCallback(
    (commitNow: boolean) => {
      if (!backed) return;
      const socket = yjs.socket as unknown as { send?: (data: string) => void } | null;
      if (!socket?.send) return;
      try {
        socket.send(
          JSON.stringify({ type: "doc", content: serializeThreads(markdown, threads, frontmatter), commitNow }),
        );
      } catch {
        // socket not ready; the next change retries
      }
    },
    [backed, yjs.socket, markdown, threads, frontmatter],
  );

  const saveNow = useCallback(() => sendDoc(true), [sendDoc]);

  // Upload a pasted image into the doc's own Drive folder; the editor inserts
  // the returned filename as a relative image. Drive docs only.
  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!drive) return null;
      try {
        const res = await fetch(`/drive/upload?deck=${encodeURIComponent(drive.fileId)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { path?: string };
        return body.path ?? null;
      } catch {
        return null;
      }
    },
    [drive],
  );

  // Ask the relay to pull the current Drive version in (used to resolve an
  // upstream change when the body also has local edits: Drive wins).
  const reloadFromDrive = useCallback(() => {
    const socket = yjs.socket as unknown as { send?: (data: string) => void } | null;
    try {
      socket?.send?.(JSON.stringify({ type: "pull" }));
    } catch {
      // socket not ready; the user can retry
    }
  }, [yjs.socket]);

  // SAVE / DIRTY STATE MACHINE (Drive-backed docs). The badge is driven by a few
  // interacting flags; the lifecycle is:
  //   load        -> userEdited=false; the effect below baselines lastCommittedHash
  //                  to the editor's own currentHash through the sync settle. While
  //                  userEdited is false the doc reads "Synced" (a load is in sync
  //                  by definition), so there is no flash and no write.
  //   first edit  -> markUserEdited() sets userEdited=true and freezes the baseline.
  //                  unsaved = currentHash !== lastCommittedHash from here on, so
  //                  reverting an edit clears the badge.
  //   autosave    -> when unsaved (and not conflict/upstreamChanged), saveNow()
  //                  relays the content; the agent writes to Drive and broadcasts
  //                  `committed{hash}`, which sets lastCommittedHash = that hash
  //                  (it matches because the relay wrote our exact serialization).
  //   conflict    -> the agent rejected a write (Drive body genuinely diverged);
  //                  pauses autosave until the user reloads.
  //   upstreamChanged -> Drive changed AND we have local edits; the user must
  //                  reload (Drive wins), forkedNotice names any preserved sibling.
  //   reloaded    -> re-arms the load state (userEdited=false, baseline cleared).
  // Content is the only truth: every comparison is on the body, never a revision id
  // or timestamp (see CLAUDE.md "content is the source of truth").
  // Track whether the shown document matches what was last saved to Drive.
  const [lastCommittedHash, setLastCommittedHash] = useState<string | null>(null);
  // True when the backend rejected a write because the file changed upstream
  // (edited in Obsidian/Drive). Auto-save never clobbers; the user reloads.
  const [conflict, setConflict] = useState(false);
  // The file changed upstream while the body also held local edits: the user
  // must reload (Drive wins) to reconcile, since we will not discard either side.
  const [upstreamChanged, setUpstreamChanged] = useState(false);
  // The relay preserved a divergent Drive version as a sibling file; holds its
  // name for a brief notice. Empty string means "forked but the name is unknown".
  const [forkedNotice, setForkedNotice] = useState<string | null>(null);
  const clearForkedNotice = useCallback(() => setForkedNotice(null), []);
  // Flipped on the user's first real edit (typing, or a comment/reply/resolve).
  // The ref is the synchronous guard for the baseline effect below; the state
  // gates the unsaved badge so it never shows "Saving" before this user has
  // actually changed anything (a fresh load is, by definition, in sync).
  const userEditedRef = useRef(false);
  const [userEdited, setUserEdited] = useState(false);
  const markUserEdited = useCallback(() => {
    userEditedRef.current = true;
    setUserEdited(true);
  }, []);
  const currentHash = useMemo(
    () => (backed ? quickHash(serializeThreads(markdown, threads, frontmatter)) : null),
    [backed, markdown, threads, frontmatter],
  );

  // The freshly opened content came from the backend, so it is already saved.
  // Baseline against the editor's OWN serialization (currentHash), NOT the file
  // bytes on Drive. The editor body carries no `mist:` block (threads live in a
  // map) and serializeThreads reformats the YAML, so the editor's serialization
  // and the stored file differ cosmetically even when the content is identical,
  // and comparing across the two flashed a spurious "Saving" (plus a real write)
  // on every open of a commented doc. Keep re-baselining through the post-sync
  // settle (the body, the `threads` map and the legacy `meta` map land on separate
  // ticks, and useTextThreads may auto-create thread metadata), and FREEZE on the
  // user's first edit; from then on currentHash drives the unsaved badge.
  useEffect(() => {
    if (!backed || userEditedRef.current || !yjs.synced || !markdown) return;
    if (currentHash !== lastCommittedHash) {
      setLastCommittedHash(currentHash); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [backed, yjs.synced, markdown, currentHash, lastCommittedHash]);

  // saveNow read through a ref so the socket listener below does not re-subscribe
  // on every keystroke (saveNow changes with the content).
  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  });

  // Clear the unsaved state when the agent confirms a commit.
  useEffect(() => {
    const socket = yjs.socket as unknown as WebSocket | null;
    if (!socket) return;
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const m = JSON.parse(e.data) as { type?: string; hash?: string; name?: string | null };
        if (m.type === "committed" && typeof m.hash === "string") {
          // A save landed: the agent confirms the hash it wrote. This is what
          // clears the unsaved badge after a real edit; it matches the client's
          // currentHash because the relay wrote exactly the client's pending
          // serialization.
          setLastCommittedHash(m.hash);
          setConflict(false);
        } else if (m.type === "conflict") {
          setConflict(true);
        } else if (m.type === "forked") {
          // The relay preserved a divergent Drive version as a sibling and left
          // our editor untouched. Clear any stale flags and push our content back
          // to the main file (the relay re-anchored, so this write now lands).
          setConflict(false);
          setUpstreamChanged(false);
          setForkedNotice(typeof m.name === "string" ? m.name : "");
          saveNowRef.current();
        } else if (m.type === "reloaded") {
          // The relay refreshed the body from Drive; the new content arrives via
          // the Yjs binding. Re-arm the load-time baselining so the adopted content
          // reads as saved, and clear flags.
          userEditedRef.current = false;
          setUserEdited(false);
          setLastCommittedHash(null);
          setConflict(false);
          setUpstreamChanged(false);
        } else if (m.type === "upstream-changed") {
          setUpstreamChanged(true);
        }
      } catch {
        // not a JSON control message
      }
    };
    socket.addEventListener("message", onMsg);
    return () => socket.removeEventListener("message", onMsg);
  }, [yjs.socket]);

  // Not "unsaved" until this user has edited: a freshly loaded file is in sync, so
  // the badge stays "Synced" through the load settle instead of flashing "Saving".
  // After the first edit, the editor's own baseline (above) decides, so reverting
  // an edit still clears the badge.
  const unsaved = backed && userEdited && !!currentHash && currentHash !== lastCommittedHash;

  // Auto-save toggle (persisted), so sync issues can be isolated by turning it
  // off. Manual save still works when off. Read after mount to avoid SSR drift.
  const [autoSave, setAutoSaveState] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("mistAutoSave") === "off") {
      setAutoSaveState(false); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, []);
  const setAutoSave = useCallback((on: boolean) => {
    setAutoSaveState(on);
    try {
      window.localStorage.setItem("mistAutoSave", on ? "on" : "off");
    } catch {
      // storage unavailable; the toggle still applies for this session
    }
  }, []);

  // Whether the slide preview follows the editor cursor. On a large deck this
  // sync is the main per-cursor-move cost, so turning it off makes the editor
  // snappier. Persistence is per-file, handled by the layout (doc-settings).
  const [followCursor, setFollowCursor] = useState(true);

  // Live save: once the document core became a faithful Y.Text (#13), a save is
  // byte-identical, so auto-save is safe. Debounce on edit-idle and let the
  // relay write conditionally (it rejects rather than clobbering an upstream
  // edit). A conflict pauses auto-save until the user reloads.
  useEffect(() => {
    if (!autoSave || !unsaved || conflict || upstreamChanged) return;
    const t = setTimeout(saveNow, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [autoSave, unsaved, conflict, upstreamChanged, saveNow]);

  // Fetch and parse the Drive folder's BibTeX library once, so the `@`-citation
  // picker and rendering work. Resolved through the Drive asset proxy.
  const [bibLib, setBibLib] = useState<BibLibrary | null>(null);
  // The doc's own `bibliography:` paths (if any), so the bib is resolved directly
  // rather than folder-guessed. Re-fetch when it appears (frontmatter loads).
  const bibKey = useMemo(() => extractBibPaths(frontmatter).join("|"), [frontmatter]);
  // Class names from the deck's own CSS, for the editor's `.`-class picker.
  const [cssClasses, setCssClasses] = useState<string[]>(DEFAULT_CLASSES);
  const cssKey = useMemo(() => extractCssPaths(frontmatter).join("|"), [frontmatter]);
  useEffect(() => {
    if (!drive || !assetToken || !cssKey) return;
    const origin = window.location.origin;
    let cancelled = false;
    (async () => {
      const all = new Set<string>(DEFAULT_CLASSES);
      for (const path of cssKey.split("|")) {
        try {
          const res = await fetch(driveAssetUrl(drive, origin, path, assetToken));
          if (!res.ok) continue;
          for (const c of parseCssClasses(await res.text())) all.add(c);
        } catch {
          // a missing stylesheet just yields no classes
        }
      }
      if (!cancelled) setCssClasses([...all].sort());
    })();
    return () => {
      cancelled = true;
    };
  }, [drive, assetToken, cssKey]);
  useEffect(() => {
    if (!drive) return;
    let cancelled = false;
    (async () => {
      // Resolve the doc's `bibliography:` paths if it has them, else find a .bib
      // in the doc's folder (or assets/), walking up.
      if (!drive.folderId) return;
      const q = bibKey
        ? bibKey.split("|").filter(Boolean).map((p) => `&path=${encodeURIComponent(p)}`).join("")
        : "";
      try {
        const res = await fetch(`/drive/bib?folder=${encodeURIComponent(drive.folderId)}${q}`);
        if (res.ok && !cancelled) setBibLib(parseBib(await res.text()));
      } catch {
        // no library available
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drive, bibKey]);

  const togglePreview = useCallback(() => {
    setPreviewToggled((v) => !v);
  }, []);

  const setPreview = useCallback((show: boolean) => {
    setPreviewToggled(show);
  }, []);

  const toggleCleanView = useCallback(() => {
    setCleanView((v) => !v);
  }, []);

  const handleViewReady = useCallback((v: EditorView | null) => {
    setView(v);
  }, []);
  // The CodeMirror editor pushes its text on every change; markdown IS the body
  // (an identity, no serialization), so save and preview read it directly.
  const setEditorText = useCallback((text: string) => setMarkdown(text), []);

  const handleCommentClick = useCallback(
    (commentText: string) => {
      const match = threads.find((t) => t.commentText === commentText);
      if (match) setActiveThreadId(activeThreadId === match.id ? null : match.id);
    },
    [threads, activeThreadId, setActiveThreadId],
  );

  const openCommentInput = useCallback(() => {
    if (view) {
      const { from, to } = view.state.selection.main;
      if (to > from) {
        const text = view.state.doc.sliceString(from, to);
        setCommentSelection({ from, to, text });
        setCommentHighlight({ from, to });
      } else {
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    }
    setCommentActive(true);
  }, [view]);

  // The editor selection toolbar's "Comment" posts this; open the sidebar input
  // on the live selection (same path as the header "New" button).
  useEffect(() => {
    const onComment = () => openCommentInput();
    window.addEventListener("mist-comment", onComment);
    return () => window.removeEventListener("mist-comment", onComment);
  }, [openCommentInput]);

  // The editor toolbar's "Reply" (selection over a comment) posts this: activate
  // that thread and signal its panel to open a reply input.
  useEffect(() => {
    const onReply = (e: Event) => {
      const commentText = (e as CustomEvent<string>).detail;
      const match = threads.find((t) => t.commentText === commentText);
      if (!match) return;
      setActiveThreadId(match.id);
      setReplySignal((s) => ({ id: match.id, n: (s?.n ?? 0) + 1 }));
    };
    window.addEventListener("mist-reply", onReply);
    return () => window.removeEventListener("mist-reply", onReply);
  }, [threads, setActiveThreadId]);

  // Insert a comment on the captured selection (or a point at the cursor).
  const insertComment = useCallback(
    (text: string) => {
      markUserEdited();
      createComment(text, commentSelection ? { from: commentSelection.from, to: commentSelection.to } : undefined);
      setCommentActive(false);
      setCommentSelection(null);
      setCommentHighlight(null);
    },
    [createComment, commentSelection, markUserEdited],
  );

  // Thread-metadata edits (reply, resolve/unresolve, delete) can change only the
  // Yjs threads map without touching the editor text, so the editor's user-edit
  // signal would miss them. Mark the edit here so the save baseline freezes and
  // the change is written back.
  const addReplyEdited = useCallback(
    (threadId: string, text: string) => { markUserEdited(); addReply(threadId, text); },
    [addReply, markUserEdited],
  );
  const resolveThreadEdited = useCallback(
    (threadId: string) => { markUserEdited(); resolveThread(threadId); },
    [resolveThread, markUserEdited],
  );
  const deleteThreadEdited = useCallback(
    (threadId: string) => { markUserEdited(); deleteThread(threadId); },
    [deleteThread, markUserEdited],
  );

  // The editor toolbar's comment Resolve/Delete (selection over a comment) post
  // these with the comment text, so they resolve/delete the matching thread (and
  // its inline markup) by content, no reliance on cursor position.
  useEffect(() => {
    const find = (e: Event) => threads.find((t) => t.commentText === (e as CustomEvent<string>).detail);
    const onResolve = (e: Event) => { const t = find(e); if (t) resolveThreadEdited(t.id); };
    const onDelete = (e: Event) => { const t = find(e); if (t) deleteThreadEdited(t.id); };
    window.addEventListener("mist-comment-resolve", onResolve);
    window.addEventListener("mist-comment-delete", onDelete);
    return () => {
      window.removeEventListener("mist-comment-resolve", onResolve);
      window.removeEventListener("mist-comment-delete", onDelete);
    };
  }, [threads, resolveThreadEdited, deleteThreadEdited]);

  const handleCommentActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        openCommentInput();
      } else {
        setCommentActive(false);
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    },
    [openCommentInput],
  );

  const clearDocument = useCallback(() => {
    // One Yjs transaction so it is atomic: clear threads before the body so the
    // thread reconcile does not re-create entries from still-present markup.
    yjs.doc.transact(() => {
      const threadsMap = yjs.doc.getMap<string>("threads");
      for (const key of Array.from(threadsMap.keys())) threadsMap.delete(key);
      const body = yjs.doc.getText("body");
      if (body.length > 0) body.delete(0, body.length);
      yjs.docState.delete("onboarding");
      yjs.docState.set("mode", "edit");
    });
    setCommentActive(false);
    setCommentSelection(null);
    setCommentHighlight(null);
  }, [yjs]);

  const handleResolveAtCursor = useCallback(() => { markUserEdited(); resolveAtCursor(); }, [resolveAtCursor, markUserEdited]);
  const handleDeleteAtCursor = useCallback(() => { markUserEdited(); deleteAtCursor(); }, [deleteAtCursor, markUserEdited]);

  // The range to tint for the active comment, derived from the live text.
  const activeCommentRange = activeRange;

  const value: DocumentContextValue = {
    docId,
    createdAt,
    yjs,
    view,
    markdown,
    cursorOffset,
    setCursor,
    frontmatter,
    role,
    docKey,
    suggestKey,
    drive,
    backed,
    saveNow,
    autoSave,
    setAutoSave,
    followCursor,
    setFollowCursor,
    unsaved,
    conflict,
    upstreamChanged,
    reloadFromDrive,
    forkedNotice,
    clearForkedNotice,
    bibLib,
    cssClasses,
    assetToken,
    uploadImage,
    // Suggest-role users are locked to suggest regardless of the shared mode
    mode: role === "suggest" ? "suggest" : yjs.mode,
    toggleMode,
    showPreview,
    previewToggled,
    togglePreview,
    setPreview,
    setPreviewHeld,
    cleanView,
    toggleCleanView,
    setCleanView,
    commentActive,
    commentSelection,
    commentHighlight,
    openCommentInput,
    handleCommentActiveChange,
    insertComment,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    threads,
    activeThreadId,
    setActiveThreadId,
    replySignal,
    activeCommentRange,
    addReply: addReplyEdited,
    resolveThread: resolveThreadEdited,
    deleteThread: deleteThreadEdited,
    isOnboarding: yjs.isOnboarding,
    clearDocument,
    handleViewReady,
    setEditorText,
    markUserEdited,
    handleCommentClick,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
