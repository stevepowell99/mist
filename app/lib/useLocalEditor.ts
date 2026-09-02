import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useUserIdentity } from "./useUserIdentity";
import { deserializeThreads, serializeThreads } from "./thread-serialization";
import { quickHash } from "~/shared/hash";
import type { DocControl, DocTransport } from "./doc-transport";
import type { DocMode } from "~/shared/types";

/** How often to ask whether the file has changed underneath the editor. */
const WATCH_MS = 2000;

/**
 * A document that is just a file.
 *
 * This is local mode's replacement for the room. The Y.Doc still exists, because
 * it is what the editor, the comment threads and suggest mode are built on, but
 * it lives only in this browser tab: nothing syncs it, nothing persists it, and
 * when the tab closes it goes with it. The file on disk is the document.
 *
 * That is the whole point of the rewrite. The failures local mode kept producing
 * all came from a second, durable copy of the content sitting in a Durable
 * Object: two rooms over one file each writing their own buffer, a room woken by
 * a reconnect writing content hours out of date, ghost collaborators left in an
 * awareness map, and a reconciliation layer (adopt, fork, re-anchor) that existed
 * only to decide which copy won. With one copy there is nothing to decide.
 *
 * What remains is an ordinary editor's contract: read the file, edit a buffer,
 * write it back, and refuse the write if the file moved underneath us.
 */
export function useLocalEditor(fileId: string) {
  const doc = useMemo(() => new Y.Doc({ guid: fileId }), [fileId]);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const { user, setName: setUserName, needsName, dismissNamePrompt } = useUserIdentity();

  const [synced, setSynced] = useState(false);
  const [mode, setModeState] = useState<DocMode>("edit");

  /** The file version this tab loaded or last wrote, and the baseline every
   *  write is conditional on. Null until the first read lands. */
  const versionRef = useRef<string | null>(null);
  const listeners = useRef(new Set<(m: DocControl) => void>());
  /** One write at a time, carrying only the newest content: a save that arrives
   *  while another is in flight replaces it rather than queueing behind it. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<string | null>(null);
  /** The editor body as it stood at the last load or save. Anything else in the
   *  Y.Text means the user has typed since, which decides whether an outside
   *  change can be taken silently or has to be offered. */
  const cleanBodyRef = useRef<string | null>(null);
  /** The outside version we have already told the user about, so a change they
   *  have chosen not to take is announced once rather than on every poll. */
  const warnedRef = useRef<string | null>(null);
  const emit = useCallback((m: DocControl) => {
    for (const fn of listeners.current) fn(m);
  }, []);

  useEffect(() => {
    awareness.setLocalStateField("user", user);
  }, [awareness, user]);

  useEffect(() => {
    const observer = () => {
      const m = docState.get("mode");
      if (m === "edit" || m === "suggest") setModeState(m);
    };
    docState.observe(observer);
    observer();
    return () => docState.unobserve(observer);
  }, [docState]);

  const setMode = useCallback((next: DocMode) => docState.set("mode", next), [docState]);

  /** Put the file's current content into the editor, in the same shape a save
   *  will write back: the file's own frontmatter with the `mist:` block lifted
   *  out, threads in the Yjs map, body as text. */
  const load = useCallback(
    async (replace: boolean) => {
      const res = await fetch(`/local/doc?id=${encodeURIComponent(fileId)}`);
      if (!res.ok) return false;
      const { text, version } = (await res.json()) as { text: string; version: string | null };
      versionRef.current = version;

      const { body, threads, frontmatter } = deserializeThreads(text);
      // LF only. CodeMirror drops \r, so CRLF in the Y.Text desyncs every editor
      // position after a line break.
      const seeded = serializeThreads(body, [], frontmatter).replace(/\r\n?/g, "\n");
      const ytext = doc.getText("body");
      doc.transact(() => {
        if (replace) {
          // Rewrite only the span that actually differs. Deleting the whole body
          // and reinserting it would work, but it throws the cursor to the top and
          // drops the scroll position on every outside edit, however small.
          const current = ytext.toString();
          if (current !== seeded) {
            let head = 0;
            const max = Math.min(current.length, seeded.length);
            while (head < max && current[head] === seeded[head]) head++;
            let tail = 0;
            while (
              tail < max - head &&
              current[current.length - 1 - tail] === seeded[seeded.length - 1 - tail]
            ) {
              tail++;
            }
            ytext.delete(head, current.length - head - tail);
            ytext.insert(head, seeded.slice(head, seeded.length - tail));
          }
        } else if (ytext.length === 0) {
          ytext.insert(0, seeded);
        }
        const map = doc.getMap<string>("threads");
        for (const thread of threads) map.set(thread.id, JSON.stringify(thread));
      });
      cleanBodyRef.current = ytext.toString();
      return true;
    },
    [doc, fileId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(false).then((ok) => {
      if (!cancelled && ok) setSynced(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const transport = useMemo<DocTransport>(() => {
    const write = async () => {
      const content = pendingRef.current;
      pendingRef.current = null;
      if (content === null) return;
      const expected = versionRef.current;
      const url =
        `/local/doc?id=${encodeURIComponent(fileId)}` +
        (expected ? `&expected=${encodeURIComponent(expected)}` : "");
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
          body: content,
        });
        if (res.status === 409) {
          emit({ type: "conflict" });
          return;
        }
        if (!res.ok) return; // transient; the next edit retries
        const { version } = (await res.json()) as { version: string | null };
        versionRef.current = version;
        cleanBodyRef.current = doc.getText("body").toString();
        emit({ type: "committed", hash: quickHash(content) });
      } catch {
        // the sidecar is unreachable; the next edit retries
      }
    };

    return {
      send(content, commitNow) {
        // Only an explicit save writes. Without commitNow this is the editor
        // telling us what it holds, which a file-backed document does not need.
        if (!commitNow) return;
        pendingRef.current = content;
        chainRef.current = chainRef.current.then(write);
      },
      pull() {
        chainRef.current = chainRef.current.then(async () => {
          if (await load(true)) emit({ type: "reloaded" });
        });
      },
      subscribe(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    };
  }, [doc, fileId, emit, load]);

  /**
   * Notice the file changing underneath us, the way a desktop editor does.
   *
   * An agent, a git checkout, Drive for Desktop or another editor writes the
   * file; a poll of its content hash spots the new version within a couple of
   * seconds. With nothing typed here since the last load or save, the change is
   * taken silently and the editor updates in place. With local edits
   * outstanding it is not taken: the upstream-changed banner offers it, so the
   * choice stays the user's.
   *
   * Polling rather than a file watcher and a socket, deliberately. The sidecar
   * is on loopback and the answer is one content hash, so the cost is nil, and
   * it adds no server-side state to a mode whose whole point is having none.
   */
  useEffect(() => {
    if (!synced) return;
    let stopped = false;

    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`/local/doc?stat=1&id=${encodeURIComponent(fileId)}`);
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string | null };
        if (stopped || !version || version === versionRef.current) return;

        const dirty =
          cleanBodyRef.current !== null && doc.getText("body").toString() !== cleanBodyRef.current;
        if (dirty) {
          if (warnedRef.current !== version) {
            warnedRef.current = version;
            emit({ type: "upstream-changed" });
          }
          return;
        }
        if (await load(true)) emit({ type: "reloaded" });
      } catch {
        // the sidecar is briefly unreachable; the next tick tries again
      }
    };

    const timer = setInterval(check, WATCH_MS);
    // Returning to the tab is when an outside change is most likely to be
    // waiting, so look then rather than waiting out the interval.
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [synced, fileId, doc, load, emit]);

  return {
    doc,
    awareness,
    // No socket, and nothing to pause or resume: there is no connection to keep
    // open and no Durable Object staying warm behind it.
    socket: null,
    transport,
    synced,
    paused: false,
    resume: () => {},
    user,
    setUserName,
    needsName,
    dismissNamePrompt,
    mode,
    setMode,
    docState,
    isOnboarding: false,
  };
}
