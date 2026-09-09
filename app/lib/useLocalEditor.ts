import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useUserIdentity } from "./useUserIdentity";
import { deserializeThreads, serializeThreads } from "./thread-serialization";
import { quickHash } from "~/shared/hash";
import type { DocControl, DocTransport } from "./doc-transport";
import { useFileSync, type FileSyncBuffer } from "./useFileSync";
import type { DocMode } from "~/shared/types";

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
 * What is left of that contract lives in `useFileSync`, which the plain editor
 * keeps too. All this file does now is say what a Y.Doc buffer means in the four
 * terms that layer asks for, and turn what happens to the file into the control
 * messages the rest of this editor already listens to.
 */
export function useLocalEditor(fileId: string) {
  const doc = useMemo(() => new Y.Doc({ guid: fileId }), [fileId]);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const { user, setName: setUserName, needsName, dismissNamePrompt } = useUserIdentity();

  const [mode, setModeState] = useState<DocMode>("edit");
  const listeners = useRef(new Set<(m: DocControl) => void>());
  /** Whether the Y.Text has been seeded. An empty Y.Text and an empty file look
   *  the same, and the sync layer reads null as "no buffer here yet". */
  const seeded = useRef(false);
  /** The latest serialisation the editor has pushed down. The Y.Text holds the
   *  body with its threads in a map, so what a save writes is not what the
   *  buffer holds, and only the layer above can produce it. */
  const outgoing = useRef<string | null>(null);

  const emit = useCallback((m: DocControl) => {
    for (const fn of listeners.current) fn(m);
  }, []);

  /**
   * A Y.Doc, in the terms the sync layer asks for.
   *
   * `normalise` is the whole reason that term exists. The body is LF-only,
   * because CodeMirror discards a carriage return and a CRLF document then
   * desyncs every editor position after a line break, and the `mist:` block is
   * lifted out into the threads map. So the file's bytes and the buffer's are
   * never equal, and comparing the two directly reads that difference as text
   * going missing.
   */
  const buffer = useMemo<FileSyncBuffer>(
    () => ({
      normalise(text) {
        const { body, frontmatter } = deserializeThreads(text);
        return serializeThreads(body, [], frontmatter).replace(/\r\n?/g, "\n");
      },
      held() {
        return seeded.current ? doc.getText("body").toString() : null;
      },
      put(text, first) {
        const { threads } = deserializeThreads(text);
        const next = this.normalise(text);
        const ytext = doc.getText("body");
        doc.transact(() => {
          if (first) {
            if (ytext.length === 0) ytext.insert(0, next);
          } else {
            // Rewrite only the span that actually differs. Deleting the whole
            // body and reinserting it would work, but it throws the cursor to
            // the top and drops the scroll position on every outside edit,
            // however small.
            const current = ytext.toString();
            if (current !== next) {
              let head = 0;
              const max = Math.min(current.length, next.length);
              while (head < max && current[head] === next[head]) head++;
              let tail = 0;
              while (
                tail < max - head &&
                current[current.length - 1 - tail] === next[next.length - 1 - tail]
              ) {
                tail++;
              }
              ytext.delete(head, current.length - head - tail);
              ytext.insert(head, next.slice(head, next.length - tail));
            }
          }
          const map = doc.getMap<string>("threads");
          for (const thread of threads) map.set(thread.id, JSON.stringify(thread));
        });
        seeded.current = true;
      },
      serialise() {
        return outgoing.current;
      },
    }),
    [doc],
  );

  const sync = useFileSync(fileId, buffer, {
    onAdopted: () => emit({ type: "reloaded" }),
    onOffered: () => emit({ type: "upstream-changed" }),
    onSaved: (written) => emit({ type: "committed", hash: quickHash(written) }),
    onConflict: () => emit({ type: "conflict" }),
  });

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

  const save = sync.save;
  const takeDisk = sync.takeDisk;
  const transport = useMemo<DocTransport>(
    () => ({
      send(content, commitNow) {
        // Every send is worth keeping, because it is the only account of what a
        // save would write, and the write on the way out of the tab needs it.
        // Only an explicit one writes: without commitNow this is the editor
        // saying what it holds, and the debounce lives above.
        outgoing.current = content;
        if (commitNow) save(content);
      },
      pull() {
        void takeDisk();
      },
      subscribe(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [save, takeDisk],
  );

  return {
    doc,
    awareness,
    // No socket, and nothing to pause or resume: there is no connection to keep
    // open and no Durable Object staying warm behind it.
    socket: null,
    transport,
    synced: sync.ready,
    alreadyOpen: sync.alreadyOpen,
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
