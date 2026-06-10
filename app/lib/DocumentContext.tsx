import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { CapturedSelection, DocMode, DocRole, GitHubMeta } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { useYjsEditor } from "~/lib/useYjsEditor";
import { useThreads } from "~/lib/useThreads";
import { findCommentTextAtCursor } from "~/lib/comment-threads";
import { serializeWithCriticMarkup } from "~/lib/critic-serializer";
import { serializeThreads } from "~/lib/thread-serialization";

export interface DocumentContextValue {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  editorInstance: TiptapEditor | null;
  markdown: string;

  // Access role from the secret link; suggest-role users can never edit
  role: DocRole;
  docKey: string | null;
  suggestKey: string | null;

  // GitHub source, if this doc was imported from a repo
  github: GitHubMeta | null;
  /** Force an immediate commit of a GitHub-backed doc back to the repo */
  commitToGitHub: () => void;

  // Mode
  mode: DocMode;
  toggleMode: () => void;

  // Preview
  showPreview: boolean;
  togglePreview: () => void;
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
  children,
}: {
  docId: string;
  createdAt: number | null;
  yjs: ReturnType<typeof useYjsEditor>;
  role?: DocRole;
  docKey?: string | null;
  suggestKey?: string | null;
  github?: GitHubMeta | null;
  children: React.ReactNode;
}) {
  const [markdown, setMarkdown] = useState("");
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [previewToggled, setPreviewToggled] = useState(false);
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
      if (!github) return;
      const socket = yjs.socket as unknown as { send?: (data: string) => void } | null;
      if (!socket?.send) return;
      try {
        socket.send(
          JSON.stringify({ type: "doc", content: serializeThreads(markdown, threads), commitNow }),
        );
      } catch {
        // socket not ready; the next change retries
      }
    },
    [github, yjs.socket, markdown, threads],
  );

  useEffect(() => {
    if (!github || !markdown) return;
    const t = setTimeout(() => sendDoc(false), 5000);
    return () => clearTimeout(t);
  }, [github, markdown, threads, sendDoc]);

  const commitToGitHub = useCallback(() => sendDoc(true), [sendDoc]);

  const togglePreview = useCallback(() => {
    setPreviewToggled((v) => !v);
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
    role,
    docKey,
    suggestKey,
    github,
    commitToGitHub,
    // Suggest-role users are locked to suggest regardless of the shared mode
    mode: role === "suggest" ? "suggest" : yjs.mode,
    toggleMode,
    showPreview,
    togglePreview,
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
