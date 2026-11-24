/**
 * Every key a gmist deck answers, in one table, so the two lists of them cannot
 * drift: the Help panel's Deck section (the deck inside either editor, in the
 * preview and in Present) and the overlay that `?` opens on the standalone
 * /slides page (the share link). The deck runtime (`slides-runtime.ts`) answers
 * F, Esc, S, Ctrl/Cmd+P and the Ctrl/Cmd+Alt chords differently in the two
 * places, so a row names its place when it holds in only one.
 *
 * Reveal's own help overlay is off (`help:false`): it lists only reveal's
 * defaults, several of which gmist rebinds, and reveal 5 has no way to remove a
 * row from it. The keys below were read from reveal 5.1.0's keyboard controller
 * (`js/controllers/keyboard.js`) and the notes plugin, plus the runtime's own
 * handlers; check both again when the reveal version in `slides-build.ts`
 * changes.
 */

export const MOD = "Ctrl/⌘";

/** One key combo as a row: the keys to press and what they do. A key of "or"
 *  is drawn as the word, between alternatives, rather than as a key. */
export interface Shortcut {
  keys: string[];
  label: string;
}

/** Where a deck key holds: in an editor (preview and Present) or on the
 *  standalone page. A row without `only` holds in both. */
export type DeckPlace = "editor" | "page";

interface DeckKey extends Shortcut {
  only?: DeckPlace;
}

const DECK_KEYS: DeckKey[] = [
  { keys: ["→", "or", "Space"], label: "Next slide or build step (also ↓, N, Page Down)" },
  { keys: ["←", "or", "Shift", "Space"], label: "Previous slide or build step (also ↑, P, Page Up)" },
  { keys: ["Alt", "→"], label: "Next or previous slide, skipping its build steps (Alt with any arrow)" },
  { keys: ["Home", "or", "End"], label: "First or last slide" },
  { keys: ["G"], label: "Jump to a slide by its number" },
  { keys: ["O"], label: "Overview of all slides" },
  { keys: ["Enter"], label: "In the overview: open the highlighted slide (the arrows move it; a click opens one too)" },
  { keys: ["wheel"], label: "In the overview: scroll through the slides" },
  { keys: ["B"], label: "Black out the screen, and back (also V, full stop or slash)" },
  { keys: ["F"], label: "Present; in Present, full screen", only: "editor" },
  { keys: ["F"], label: "Full screen", only: "page" },
  { keys: ["Esc"], label: "Close the overview, or leave Present", only: "editor" },
  { keys: ["Esc"], label: "Leave full screen", only: "page" },
  { keys: ["S"], label: "Speaker view: notes, next slide and timer, in a second window", only: "page" },
  { keys: [MOD, "P"], label: "Print the deck to PDF", only: "editor" },
  { keys: [MOD, "Alt", "…"], label: "The view and panel shortcuts work with the focus in the deck too", only: "editor" },
  { keys: ["?", "or", "F1"], label: "These shortcuts" },
];

/** The deck keys that hold in one place, in table order. */
export function deckKeys(place: DeckPlace): Shortcut[] {
  return DECK_KEYS.filter((k) => !k.only || k.only === place).map(({ keys, label }) => ({ keys, label }));
}
