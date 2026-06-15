import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { CapturedSelection, DocMode, DocRole, DriveMeta, GitHubMeta } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { useYjsEditor } from "~/lib/useYjsEditor";
import { useThreads } from "~/lib/useThreads";
import { findCommentTextAtCursor } from "~/lib/comment-threads";
import { serializeWithCriticMarkup } from "~/lib/critic-serializer";
import { serializeThreads, rawFrontmatter } from "~/lib/thread-serialization";
import { quickHash } from "~/shared/hash";
import { rawAssetUrl } from "~/lib/github";
import { getDriveKey } from "~/lib/drive-key";
import { parseBib, type BibLibrary } from "~/lib/citations";

export interface DocumentContextValue {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  editorInstance: TiptapEditor | null;
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
  activateComment: (commentText: string) => void;
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
  handleEditorReady: (editor: TiptapEditor) => void;
  handleCommentClick: (commentText: string) => void;
}

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
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  // The document's frontmatter now lives in the editor text (shown and editable),
  // so derive it from the markdown; edits to the YAML flow straight into the
  // preview/slides. Fall back to the Yjs meta map for documents opened before
  // this change (their body has no frontmatter), so deck detection still works.
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

  const showPreview = previewToggled || previewHeld;

  const {
    threads,
    activateComment,
    addReply,
    resolveThread,
    deleteThread,
    activeThreadId,
    setActiveThreadId,
    suppressSelectionRef,
  } = useThreads({ doc: yjs.doc, editor: editorInstance, user: yjs.user });

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

  // Explicit save only: no auto-commit effect here. Writing back happens solely
  // when the user presses save (saveNow -> sendDoc(true)).
  const saveNow = useCallback(() => sendDoc(true), [sendDoc]);

  // Track whether the shown document matches what was last committed to GitHub.
  const [lastCommittedHash, setLastCommittedHash] = useState<string | null>(null);
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
        }
      } catch {
        // not a JSON control message
      }
    };
    socket.addEventListener("message", onMsg);
    return () => socket.removeEventListener("message", onMsg);
  }, [yjs.socket]);

  const unsaved = backed && !!currentHash && currentHash !== lastCommittedHash;

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

  const handleEditorReady = useCallback((editor: TiptapEditor) => {
    setEditorInstance(editor);
    const update = () => setMarkdown(serializeWithCriticMarkup(editor.state.doc));
    update();
    editor.on("update", update);
  }, []);

  const handleCommentClick = useCallback(
    (commentText: string) => {
      const match = threads.find((t) => t.commentText === commentText);
      if (match) {
        suppressSelectionRef.current = true;
        setActiveThreadId(activeThreadId === match.id ? null : match.id);
      }
    },
    [threads, activeThreadId, setActiveThreadId, suppressSelectionRef],
  );

  const openCommentInput = useCallback(() => {
    if (editorInstance) {
      const { from, to, empty } = editorInstance.state.selection;
      if (!empty) {
        const text = editorInstance.state.doc.textBetween(from, to);
        setCommentSelection({ from, to, text });
        setCommentHighlight({ from, to });
      } else {
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    }
    setCommentActive(true);
  }, [editorInstance]);

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
    if (!editorInstance) return;
    // Wrap in a Yjs transaction so all changes are atomic —
    // clearing threads before content prevents reconcile from
    // re-creating thread entries from still-present inline marks.
    yjs.doc.transact(() => {
      const threadsMap = yjs.doc.getMap<string>("threads");
      const keys = Array.from(threadsMap.keys());
      for (const key of keys) threadsMap.delete(key);
      yjs.docState.delete("onboarding");
      yjs.docState.set("mode", "edit");
    });
    editorInstance.commands.clearContent();
    // Reset local UI state
    setCommentActive(false);
    setCommentSelection(null);
    setCommentHighlight(null);
  }, [editorInstance, yjs]);

  const handleResolveAtCursor = useCallback(() => {
    if (!editorInstance) return;
    const text = findCommentTextAtCursor(editorInstance);
    if (!text) return;
    const match = threads.find((t) => t.commentText === text);
    if (match) resolveThread(match.id);
  }, [editorInstance, threads, resolveThread]);

  const handleDeleteAtCursor = useCallback(() => {
    if (!editorInstance) return;
    const text = findCommentTextAtCursor(editorInstance);
    if (!text) return;
    const match = threads.find((t) => t.commentText === text);
    if (match) deleteThread(match.id);
  }, [editorInstance, threads, deleteThread]);

  const activeCommentRange = useMemo(() => {
    if (!activeThreadId) return null;
    const thread = threads.find((t) => t.id === activeThreadId);
    if (!thread?.position || !thread.endPosition) return null;

    let from = thread.position;
    const to = thread.endPosition;

    // Expand range to include preceding highlight if present
    if (editorInstance && thread.highlightText && from > 0) {
      const highlightType = editorInstance.schema.marks.criticHighlight;
      if (highlightType) {
        const $pos = editorInstance.state.doc.resolve(from - 1);
        const hlRange = getMarkRange($pos, highlightType);
        if (hlRange && hlRange.to === from) {
          from = hlRange.from;
        }
      }
    }

    return { from, to };
  }, [activeThreadId, threads, editorInstance]);

  const value: DocumentContextValue = {
    docId,
    createdAt,
    yjs,
    editorInstance,
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
    activateComment,
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
    handleEditorReady,
    handleCommentClick,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
