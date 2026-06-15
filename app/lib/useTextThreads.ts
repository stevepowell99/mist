import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import type { Doc as YDoc } from "yjs";
import type { ThreadData, ThreadReply, UserInfo } from "~/shared/types";
import { matchThreadsToComments, type MatchedThread } from "~/lib/comment-threads";
import {
  scanTextComments,
  insertCommentChange,
  removeCommentChange,
  activeRangeFor,
} from "~/lib/cm-comments";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function readAllThreads(map: { forEach: (cb: (val: string, key: string) => void) => void }): ThreadData[] {
  const threads: ThreadData[] = [];
  map.forEach((val) => {
    try {
      threads.push(JSON.parse(val));
    } catch {
      // ignore malformed entries
    }
  });
  return threads;
}

/**
 * Comment threads for the CodeMirror 6 / Y.Text core (#13). The TipTap
 * `useThreads` scanned marks; this scans the literal `{>>...<<}` /`{==...==}`
 * text (`scanTextComments`) and reuses the same `matchThreadsToComments`, so the
 * thread metadata model (the Yjs `threads` map, folded into `mist:` frontmatter
 * on save) is unchanged. Because the markup is real text, comment positions
 * follow concurrent edits via the CRDT, so there is no separate anchor to keep.
 */
export function useTextThreads({
  doc,
  view,
  text,
  user,
}: {
  doc: YDoc;
  view: EditorView | null;
  text: string;
  user: UserInfo;
}) {
  const [threads, setThreads] = useState<MatchedThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const threadsMapRef = useRef(doc.getMap<string>("threads"));
  const pendingActivateRef = useRef<string | null>(null);
  const reconcilingRef = useRef(false);

  const reconcile = useCallback(() => {
    const comments = scanTextComments(text);
    const allThreads = readAllThreads(threadsMapRef.current);

    // Auto-create threads for comments with no metadata yet (the text is ground
    // truth, exactly as the TipTap path treats marks).
    const matchedText = new Set<number>();
    const sorted = [...allThreads].sort((a, b) => a.createdAt - b.createdAt);
    for (const t of sorted) {
      for (let i = 0; i < comments.length; i++) {
        if (matchedText.has(i)) continue;
        if (comments[i].commentText === t.commentText) {
          matchedText.add(i);
          break;
        }
      }
    }
    let created = false;
    for (let i = 0; i < comments.length; i++) {
      if (matchedText.has(i)) continue;
      const c = comments[i];
      const id = generateId();
      const thread: ThreadData = {
        id,
        commentText: c.commentText,
        highlightText: c.highlightText,
        author: user,
        createdAt: Date.now(),
        resolved: false,
        replies: [],
      };
      reconcilingRef.current = true;
      threadsMapRef.current.set(id, JSON.stringify(thread));
      reconcilingRef.current = false;
      created = true;
      if (pendingActivateRef.current === c.commentText) {
        setActiveThreadId(id);
        pendingActivateRef.current = null;
      }
    }

    const finalThreads = created ? readAllThreads(threadsMapRef.current) : allThreads;
    const matched = matchThreadsToComments(finalThreads, comments);
    matched.sort((a, b) => {
      if (a.position !== undefined && b.position !== undefined) return a.position - b.position;
      if (a.position !== undefined) return -1;
      if (b.position !== undefined) return 1;
      return a.createdAt - b.createdAt;
    });
    setThreads(matched);
  }, [text, user]);

  // Reconcile when the text changes (local or remote edits flow through `text`).
  useEffect(() => {
    reconcile();
  }, [reconcile]);

  // Reconcile on remote thread-map changes (replies, resolves from others).
  useEffect(() => {
    const map = threadsMapRef.current;
    const observer = () => {
      if (!reconcilingRef.current) reconcile();
    };
    map.observe(observer);
    return () => map.unobserve(observer);
  }, [reconcile]);

  const createComment = useCallback(
    (note: string) => {
      if (!view || !note.trim()) return;
      const { from, to } = view.state.selection.main;
      const { changes, cursor } = insertCommentChange(view.state.doc.toString(), from, to, note);
      pendingActivateRef.current = note;
      view.dispatch({
        changes,
        selection: { anchor: cursor },
        scrollIntoView: true,
        userEvent: "input.comment",
      });
      view.focus();
    },
    [view],
  );

  const addReply = useCallback(
    (threadId: string, replyText: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (!raw) return;
      const thread: ThreadData = JSON.parse(raw);
      const reply: ThreadReply = { id: generateId(), author: user, text: replyText, createdAt: Date.now() };
      thread.replies.push(reply);
      threadsMapRef.current.set(threadId, JSON.stringify(thread));
    },
    [user],
  );

  const removeInline = useCallback(
    (thread: ThreadData) => {
      if (!view) return;
      const changes = removeCommentChange(view.state.doc.toString(), thread.commentText, thread.highlightText);
      if (changes.length) view.dispatch({ changes, userEvent: "input.comment" });
    },
    [view],
  );

  const resolveThread = useCallback(
    (threadId: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (!raw) return;
      const thread: ThreadData = JSON.parse(raw);
      if (!thread.resolved) {
        removeInline(thread);
        thread.resolved = true;
      } else {
        thread.resolved = false;
      }
      threadsMapRef.current.set(threadId, JSON.stringify(thread));
    },
    [removeInline],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (raw) removeInline(JSON.parse(raw));
      threadsMapRef.current.delete(threadId);
      setActiveThreadId((prev) => (prev === threadId ? null : prev));
    },
    [removeInline],
  );

  const jumpToThread = useCallback(
    (thread: MatchedThread) => {
      setActiveThreadId(thread.id);
      if (view && thread.position !== undefined) {
        view.dispatch({ selection: { anchor: thread.position }, scrollIntoView: true });
        view.focus();
      }
    },
    [view],
  );

  // The range to tint for the active thread, recomputed against the live text.
  const activeRange = useMemo(() => {
    const t = threads.find((x) => x.id === activeThreadId);
    if (!t) return null;
    return activeRangeFor(text, t.commentText, t.highlightText);
  }, [threads, activeThreadId, text]);

  return {
    threads,
    activeThreadId,
    setActiveThreadId,
    activeRange,
    createComment,
    addReply,
    resolveThread,
    deleteThread,
    jumpToThread,
  };
}
