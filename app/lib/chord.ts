import { useEffect, useRef, useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";

/**
 * The Ctrl/Cmd+Alt chords: one registry that every chord handler registers
 * with, fed by every place a chord can be pressed.
 *
 * - A component registers what it handles with `useChords`, for as long as it
 *   is mounted: each editor its view and panel chords, Quick open J, the comment
 *   box M, the folder sidebar F, the Help panel /, each CodeMirror editor G.
 * - Three sources feed `runChord`: the window's keydown, each CodeMirror editor
 *   (`chordKeys`, ahead of CodeMirror's own keymaps), and the deck's sandboxed
 *   iframe, which cannot share this window and posts its chords as `mist-key`.
 * - The Help panel lists what is registered (`useChordList`), so it can only
 *   name a chord that something on the page handles, with that handler's label,
 *   and says which chords do not work from the deck.
 *
 * Chords CodeMirror itself binds and nobody registers (fold all on Ctrl+Alt+[
 * and ]) fall through to CodeMirror untouched.
 */

/**
 * Resolve a Ctrl/Cmd+Alt keyboard chord to a canonical lowercase token
 * ("e", "1", "[", "/"), or null if the event is not such a chord.
 *
 * It reads the physical key (e.code) first, so a Windows AltGr layout (where
 * Ctrl+Alt+E emits an accented character and e.key is not "e") and the numpad
 * digits still resolve; it falls back to e.key for anything unmapped.
 */
export function modAltChord(e: KeyboardEvent): string | null {
  // AltGr (common on Windows/UK layouts) can report as the AltGraph modifier
  // rather than altKey, so accept either.
  const alt = e.altKey || (typeof e.getModifierState === "function" && e.getModifierState("AltGraph"));
  if (!(e.ctrlKey || e.metaKey) || !alt) return null;
  const c = e.code;
  if (c.startsWith("Key")) return c.slice(3).toLowerCase(); // KeyE -> "e"
  if (c.startsWith("Digit")) return c.slice(5); // Digit1 -> "1"
  if (c.startsWith("Numpad") && /\d$/.test(c)) return c.slice(-1); // Numpad1 -> "1"
  if (c === "BracketLeft") return "[";
  if (c === "BracketRight") return "]";
  if (c === "Minus") return "-";
  if (c === "Equal") return "=";
  if (c === "Slash") return "/";
  const k = e.key.toLowerCase();
  return k.length === 1 ? k : null;
}

/** Which Help panel section a chord is listed in. */
export type ChordGroup = "view" | "panels" | "editor";

export interface Chord {
  /** The token `modAltChord` gives: "s", "1", "/", "-". */
  key: string;
  /** What it does, as the Help panel says it. */
  label: string;
  group: ChordGroup;
  /** Return false to decline, which passes the chord to an earlier registration. */
  run: () => boolean | void;
  /** False for a chord that needs the editor, so it does nothing from the deck. */
  deck?: boolean;
  /** Tried, and listed, only when nothing else registers the key: a default
   *  that a page may give another meaning (CodeMirror's go-to-line on G). */
  fallback?: boolean;
}

/** Where a chord was pressed: on this page, or in the deck's iframe. */
export type ChordSource = "keys" | "deck";

// Registration order. A key's registrations are tried latest first, any
// fallback after all the rest, whatever order the components mounted in.
let entries: Chord[] = [];
const tryOrder = () => [...entries.filter((c) => c.fallback), ...entries.filter((c) => !c.fallback)];
let listed: readonly Chord[] = [];
const subscribers = new Set<() => void>();

/** The order the Help panel lists chords in, within a group. */
const ORDER = "s1423pn-=fjdcg/m";
const GROUPS: ChordGroup[] = ["view", "panels", "editor"];
const rank = (c: Chord) => {
  const i = ORDER.indexOf(c.key);
  return GROUPS.indexOf(c.group) * 100 + (i < 0 ? 99 : i);
};

function changed() {
  // One row per key, the registration that is tried first, so a key whose
  // meaning changes with context (G) is listed with the meaning it has here.
  const top = new Map<string, Chord>();
  for (const c of tryOrder()) top.set(c.key, c);
  listed = [...top.values()].sort((a, b) => rank(a) - rank(b));
  subscribers.forEach((f) => f());
}

/** Run the chord `key`; true if something handled it. */
export function runChord(key: string, from: ChordSource): boolean {
  const order = tryOrder();
  for (let i = order.length - 1; i >= 0; i--) {
    const c = order[i];
    if (c.key !== key || (from === "deck" && c.deck === false)) continue;
    if (c.run() !== false) return true;
  }
  return false;
}

/** True if some registration of `key` runs when the deck forwards it. */
export function chordWorksFromDeck(key: string): boolean {
  return entries.some((c) => c.key === key && c.deck !== false);
}

const onKey = (e: KeyboardEvent) => {
  const c = modAltChord(e);
  if (c && runChord(c, "keys")) e.preventDefault();
};
const onMessage = (e: MessageEvent) => {
  const d = e.data as { type?: string; chord?: string } | null;
  if (d?.type === "mist-key" && typeof d.chord === "string") runChord(d.chord, "deck");
};
let listening = false;
function listen(on: boolean) {
  if (typeof window === "undefined" || on === listening) return;
  if (on) {
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
  } else {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("message", onMessage);
  }
  listening = on;
}

/**
 * Register `chords` while the calling component is mounted. Each `run` is
 * read fresh when the chord fires, so the array can be rebuilt every render;
 * the registration itself changes only when a key, label, group or deck flag
 * does.
 */
export function useChords(chords: Chord[]): void {
  const latest = useRef(chords);
  useEffect(() => {
    latest.current = chords;
  });
  const signature = chords
    .map((c) => [c.key, c.label, c.group, c.deck !== false, !!c.fallback].join("\u0000"))
    .join("\u0001");
  useEffect(() => {
    const mine: Chord[] = latest.current.map((c) => ({
      ...c,
      run: () => {
        const now = latest.current.find((x) => x.key === c.key);
        return now ? now.run() : false;
      },
    }));
    entries = [...entries, ...mine];
    listen(true);
    changed();
    return () => {
      entries = entries.filter((c) => !mine.includes(c));
      if (!entries.length) listen(false);
      changed();
    };
  }, [signature]);
}

const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => subscribers.delete(f);
};
const getListed = () => listed;
const getNone = (): readonly Chord[] => [];

/** The registered chords, one per key, in the Help panel's order; live. */
export function useChordList(): readonly Chord[] {
  return useSyncExternalStore(subscribe, getListed, getNone);
}

/**
 * The CodeMirror side: a registered chord pressed in the editor runs here,
 * ahead of CodeMirror's own keymaps, and is stopped so the window listener does
 * not run it again. An unregistered chord is left to CodeMirror.
 */
export const chordKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event) {
      const c = modAltChord(event);
      if (!c || !runChord(c, "keys")) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  }),
);
