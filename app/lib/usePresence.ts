import { useCallback, useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

/**
 * Collaborative presence over Yjs awareness: who else is connected and which
 * slide each is on. The `user` field is published by useYjsEditor (name +
 * colour); here we add a `slide` field and read every peer's state. Used for the
 * navbar avatar row and the per-slide markers in the outline.
 */
export interface Peer {
  clientID: number;
  name: string;
  color: string;
  /** Flat slide index the peer is focused on, or null if unknown / not a deck. */
  slide: number | null;
}

interface AwarenessUser {
  name?: string;
  color?: string;
}

export function usePresence(awareness: Awareness): {
  peers: Peer[];
  setLocalSlide: (slide: number | null) => void;
} {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const read = () => {
      const out: Peer[] = [];
      awareness.getStates().forEach((state, clientID) => {
        if (clientID === awareness.clientID) return; // skip self
        const user = (state as { user?: AwarenessUser }).user;
        if (!user) return; // not yet identified
        const slide = (state as { slide?: unknown }).slide;
        out.push({
          clientID,
          name: user.name || "Someone",
          color: user.color || "#888888",
          slide: typeof slide === "number" ? slide : null,
        });
      });
      out.sort((a, b) => a.clientID - b.clientID); // stable order
      // Skip the state update when nothing we render changed (awareness also
      // fires on every remote cursor move, which we ignore), so the layout does
      // not re-render on each remote keystroke.
      setPeers((prev) =>
        prev.length === out.length &&
        prev.every(
          (p, i) =>
            p.clientID === out[i].clientID &&
            p.name === out[i].name &&
            p.color === out[i].color &&
            p.slide === out[i].slide,
        )
          ? prev
          : out,
      );
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);

  const setLocalSlide = useCallback(
    (slide: number | null) => {
      awareness.setLocalStateField("slide", slide);
    },
    [awareness],
  );

  return { peers, setLocalSlide };
}
