import { useEffect } from "react";
import { modAltChord } from "~/lib/chord";

/**
 * Route mod+alt chords to `runChord` from the two sources that reach the editor
 * page: window keydown (only when focus is outside CodeMirror, which handles and
 * stops its own, so there is no double-toggle) and the slides iframe, which
 * cannot share our window so it postMessages its chords. Extracted from docs.$id
 * so the wiring is isolated; runChord stays in the route since it drives view
 * state. (The previous inline version removed the keydown listener with the
 * capture flag set while it was added on the bubble phase, so cleanup never
 * matched; both now use the bubble phase.)
 */
export function useChordListener(runChord: (chord: string) => boolean): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = modAltChord(e);
      if (c && runChord(c)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; chord?: string };
      if (d?.type === "mist-key" && typeof d.chord === "string") runChord(d.chord);
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
    };
  }, [runChord]);
}
