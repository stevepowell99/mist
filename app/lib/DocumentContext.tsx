import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { CapturedSelection, DocMode, DocRole, DriveMeta, GitHubMeta } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { useYjsEditor } from "~/lib/useYjsEditor";
import { useTextThreads } from "~/lib/useTextThreads";
import { serializeThreads } from "~/lib/thread-serialization";
import { quickHash } from "~/shared/hash";
import { rawAssetUrl } from "~/lib/github";
import { getDriveKey } from "~/lib/drive-key";
import { parseBib, type BibLibrary } from "~/lib/citations";

export interface DocumentContextValue {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  /** The CodeMirror view backing the editor (Y.Text core). */
  view: EditorView | null;
  markdown: string;
  /** The document's own YAML frontmatter (theme, css, format...), held in the
   *  doc so it survives import and round-trips on commit-back. "" if none. */
  frontmatter: string;

  // Access role from the secret link; suggest-role users can never edit
  role: DocRole;
  docKey: string | null;
  suggestKey: string | null;

  // GitHub source, if this doc was imported from a repo
  github: GitHubMeta | null;
  // Google Drive source, if this doc was opened from Drive
  drive: DriveMeta | null;
  /** True when the doc is bound to a backend (GitHub or Drive) and writes back */
  backed: boolean;
  /** Force an immediate write of the doc back to its backend (GitHub or Drive) */
  saveNow: () => void;
  /** True when the document has edits not yet written back to its backend */
  unsaved: boolean;
  /** True when the backend rejected a write because the file changed upstream */
  conflict: boolean;
  /** Parsed BibTeX library for citation rendering, if found in the repo */
  bibLib: BibLibrary | null;

  // Mode
  mode: DocMode;
  toggleMode: () => void;

  // Preview
  showPreview: boolean;
  togglePreview: () => void;
  setPreview: (show: boolean) => void;
  setPreviewHeld: (held: boolean) => void;

  // Clean view
  cleanView: boolean;
  toggleCleanView: () => void;

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
  github = null,
  drive = null,
  initialPreview = false,
  children,
}: {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  role?: DocRole;
  docKey?: string | null;
  suggestKey?: string | null;
  github?: GitHubMeta | null;
  drive?: DriveMeta | null;
  initialPreview?: boolean;
  children: React.ReactNode;
}) {
  // Either backend means edits are relayed for write-back to the source file.
  const backed = !!github || !!drive;
  const [markdown, setMarkdown] = useState("");
  const [frontmatter, setFrontmatter] = useState("");
  const [view, setView] = useState<EditorView | null>(null);

  // The file's frontmatter is kept verbatim in the Yjs "meta" map (seeded at
  // import), separate from the editor body, so the editor round-trip cannot
  // mangle multi-line YAML. Read it once synced and observe for changes.
  useEffect(() => {
    const meta = yjs.doc.getMap<string>("meta");
    const read = () => setFrontmatter((meta.get("frontmatter") as string) ?? "");
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [yjs.doc]);
  const [previewToggled, setPreviewToggled] = useState(initialPreview);
  const [previewHeld, setPreviewHeld] = useState(false);
  const [commentActive, setCommentActive] = useState(false);
  const [commentSelection, setCommentSelection] = useState<CapturedSelection | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<{ from: number; to: number } | null>(null);
  const [cleanView, setCleanView] = useState(true);

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

  // Relay the serialized document to the agent for GitHub-backed docs. The
  // agent auto-commits on a throttle (and after the last editor disconnects),
  // so web edits reach the repo without anyone pressing save.
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

  // Track whether the shown document matches what was last committed to GitHub.
  const [lastCommittedHash, setLastCommittedHash] = useState<string | null>(null);
  // True when the backend rejected a write because the file changed upstream
  // (edited in Obsidian/Drive). Auto-save never clobbers; the user reloads.
  const [conflict, setConflict] = useState(false);
  const baselineSetRef = useRef(false);
  const currentHash = useMemo(
    () => (backed ? quickHash(serializeThreads(markdown, threads, frontmatter)) : null),
    [backed, markdown, threads, frontmatter],
  );

  // The freshly opened content came from the backend, so treat it as already saved.
  useEffect(() => {
    if (!backed || baselineSetRef.current || !markdown) return;
    baselineSetRef.current = true;
    setLastCommittedHash(currentHash); // eslint-disable-line react-hooks/set-state-in-effect
  }, [backed, markdown, currentHash]);

  // Clear the unsaved state when the agent confirms a commit.
  useEffect(() => {
    const socket = yjs.socket as unknown as WebSocket | null;
    if (!socket) return;
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const m = JSON.parse(e.data) as { type?: string; hash?: string };
        if (m.type === "committed" && typeof m.hash === "string") {
          setLastCommittedHash(m.hash);
          setConflict(false);
        } else if (m.type === "conflict") {
          setConflict(true);
        }
      } catch {
        // not a JSON control message
      }
    };
    socket.addEventListener("message", onMsg);
    return () => socket.removeEventListener("message", onMsg);
  }, [yjs.socket]);

  const unsaved = backed && !!currentHash && currentHash !== lastCommittedHash;

  // Live save: once the document core became a faithful Y.Text (#13), a save is
  // byte-identical, so auto-save is safe. Debounce on edit-idle and let the
  // relay write conditionally (it rejects rather than clobbering an upstream
  // edit). A conflict pauses auto-save until the user reloads.
  useEffect(() => {
    if (!unsaved || conflict) return;
    const t = setTimeout(saveNow, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [unsaved, conflict, saveNow]);

  // Fetch and parse the backend's BibTeX library once, so the `@`-citation
  // picker and rendering work for both GitHub repos and Drive folders. The same
  // candidate names are tried; Drive resolves them through the asset proxy.
  const [bibLib, setBibLib] = useState<BibLibrary | null>(null);
  const bibFetchedRef = useRef(false);
  useEffect(() => {
    if ((!github && !drive) || bibFetchedRef.current) return;
    bibFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      // Drive: one request that finds a .bib in the doc's folder (or assets/).
      if (drive) {
        if (!drive.folderId) return;
        try {
          const key = getDriveKey() ?? "";
          const res = await fetch(`/drive/bib?folder=${encodeURIComponent(drive.folderId)}`, {
            headers: { "X-Drive-Key": key },
          });
          if (res.ok && !cancelled) setBibLib(parseBib(await res.text()));
        } catch {
          // no library available
        }
        return;
      }
      // GitHub: probe the usual library names in the repo.
      const candidates = [
        "assets/MyLibrary.bib",
        "assets/My Library.bib",
        "My Library.bib",
        "MyLibrary.bib",
        "references.bib",
        "bibliography.bib",
      ];
      for (const path of candidates) {
        try {
          const res = await fetch(rawAssetUrl(github!, path));
          if (res.ok) {
            const text = await res.text();
            if (!cancelled) setBibLib(parseBib(text));
            return;
          }
        } catch {
          // try the next candidate path
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [github, drive]);

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

  // Insert a comment on the captured selection (or a point at the cursor).
  const insertComment = useCallback(
    (text: string) => {
      createComment(text, commentSelection ? { from: commentSelection.from, to: commentSelection.to } : undefined);
      setCommentActive(false);
      setCommentSelection(null);
      setCommentHighlight(null);
    },
    [createComment, commentSelection],
  );

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

  const handleResolveAtCursor = useCallback(() => resolveAtCursor(), [resolveAtCursor]);
  const handleDeleteAtCursor = useCallback(() => deleteAtCursor(), [deleteAtCursor]);

  // The range to tint for the active comment, derived from the live text.
  const activeCommentRange = activeRange;

  const value: DocumentContextValue = {
    docId,
    createdAt,
    yjs,
    view,
    markdown,
    frontmatter,
    role,
    docKey,
    suggestKey,
    github,
    drive,
    backed,
    saveNow,
    unsaved,
    conflict,
    bibLib,
    // Suggest-role users are locked to suggest regardless of the shared mode
    mode: role === "suggest" ? "suggest" : yjs.mode,
    toggleMode,
    showPreview,
    togglePreview,
    setPreview,
    setPreviewHeld,
    cleanView,
    toggleCleanView,
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
    activeCommentRange,
    addReply,
    resolveThread,
    deleteThread,
    isOnboarding: yjs.isOnboarding,
    clearDocument,
    handleViewReady,
    setEditorText,
    handleCommentClick,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
