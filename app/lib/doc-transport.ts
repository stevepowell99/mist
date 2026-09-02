/**
 * How the editor talks to wherever the document is stored.
 *
 * Two implementations, because the two storage modes are genuinely different
 * shapes. A Drive document lives in a room: a server-side Yjs copy in a Durable
 * Object that several browsers sync through, so the transport is a WebSocket and
 * the room has opinions about which copy wins. A local file has no room at all.
 * The browser holds the buffer, the file holds the document, and the transport
 * is an HTTP read and an HTTP write.
 *
 * Keeping both behind this one interface is what lets DocumentContext, and every
 * component under it, stay ignorant of which mode it is in.
 */

/** A control message about the stored document's state. */
export type DocControl =
  | { type: "committed"; hash: string }
  | { type: "conflict" }
  | { type: "forked"; name: string | null }
  | { type: "reloaded" }
  | { type: "upstream-changed" };

export interface DocTransport {
  /** Push the serialized document. `commitNow` asks for it to be written out. */
  send(content: string, commitNow: boolean): void;
  /** Take the stored version, discarding local edits. */
  pull(): void;
  /** Listen for control messages. Returns an unsubscribe. */
  subscribe(listener: (message: DocControl) => void): () => void;
}

/** The room transport: relay to the agent and read its control messages back. */
export function agentTransport(socket: unknown): DocTransport {
  const ws = socket as WebSocket | null;
  return {
    send(content, commitNow) {
      const s = socket as { send?: (data: string) => void } | null;
      if (!s?.send) return;
      try {
        s.send(JSON.stringify({ type: "doc", content, commitNow }));
      } catch {
        // socket not ready; the next change retries
      }
    },
    pull() {
      const s = socket as { send?: (data: string) => void } | null;
      try {
        s?.send?.(JSON.stringify({ type: "pull" }));
      } catch {
        // socket not ready; the user can retry
      }
    },
    subscribe(listener) {
      if (!ws) return () => {};
      const onMessage = (e: MessageEvent) => {
        if (typeof e.data !== "string") return;
        try {
          listener(JSON.parse(e.data) as DocControl);
        } catch {
          // not a JSON control message
        }
      };
      ws.addEventListener("message", onMessage);
      return () => ws.removeEventListener("message", onMessage);
    },
  };
}
