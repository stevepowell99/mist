import { EditorState, StateEffect, StateField, type TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { placedRanges, type HelperChange } from "./helper-edits";

/**
 * What the helper changed, kept in the editor so it can be shown and undone.
 *
 * Each mark is one change from one helper turn: where its text now sits, the
 * text it wrote and the text it replaced. The field maps every mark through
 * every later transaction, so the range follows the words as the user types
 * around them. A mark is highlighted while it is fresh; it stays, unhighlighted,
 * so the card's Undo still works after the highlight has faded.
 *
 * Undo is by content, like everything else in gmist: it puts the old text back
 * only while each range still holds exactly what the helper wrote. Once the
 * user has edited inside one, the card refuses and Ctrl+Z, which knows the
 * interleaving, is the way back.
 */
export interface HelperMark {
  turn: string;
  index: number;
  from: number;
  to: number;
  inserted: string;
  original: string;
  fresh: boolean;
}

const addMarks = StateEffect.define<HelperMark[]>();
const dropTurn = StateEffect.define<string>();
const fadeMarks = StateEffect.define<null>();

export const helperMarks = StateField.define<HelperMark[]>({
  create: () => [],
  update(marks, tr) {
    let next = marks;
    if (tr.docChanged) {
      next = next.map((m) => {
        // Text typed against either edge stays outside the mark.
        const from = tr.changes.mapPos(m.from, 1);
        const to = Math.max(from, tr.changes.mapPos(m.to, -1));
        return from === m.from && to === m.to ? m : { ...m, from, to };
      });
    }
    for (const e of tr.effects) {
      if (e.is(addMarks)) next = [...next, ...e.value];
      else if (e.is(dropTurn)) next = next.filter((m) => m.turn !== e.value);
      else if (e.is(fadeMarks)) next = next.map((m) => (m.fresh ? { ...m, fresh: false } : m));
    }
    return next;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (marks): DecorationSet =>
      Decoration.set(
        marks.filter((m) => m.fresh && m.to > m.from).map((m) => changed.range(m.from, m.to)),
        true,
      ),
    ),
});

const changed = Decoration.mark({ class: "cm-helper-change" });

const theme = EditorView.baseTheme({
  ".cm-helper-change": { backgroundColor: "rgba(170, 220, 0, 0.28)", transition: "background-color 0.6s" },
  "&dark .cm-helper-change": { backgroundColor: "rgba(170, 220, 0, 0.22)" },
});

/** The editor extension: the field and its highlight. */
export const helperMarksExtension = [helperMarks, theme];

/**
 * One helper turn's changes as a transaction: its own undo step (so Ctrl+Z
 * takes back exactly the helper's edit and none of the typing either side of
 * it), marked, and tagged as an edit the helper made rather than typing.
 */
export function helperEditSpec(state: EditorState, turn: string, changes: HelperChange[]): TransactionSpec {
  const marks: HelperMark[] = placedRanges(changes).map((r, i) => ({
    turn,
    index: r.index,
    from: r.from,
    to: r.to,
    inserted: changes[i].insert,
    original: state.sliceDoc(changes[i].from, changes[i].to),
    fresh: true,
  }));
  return {
    changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
    effects: addMarks.of(marks),
    annotations: isolateHistory.of("full"),
    userEvent: "input.helper",
  };
}

/** Where the change from op `index` of `turn` now is, for the card to jump to. */
export function helperMarkAt(state: EditorState, turn: string, index: number): HelperMark | null {
  return state.field(helperMarks, false)?.find((m) => m.turn === turn && m.index === index) ?? null;
}

/** Take the highlight off every mark; their ranges stay, for Undo. */
export function fadeHelperMarks(): TransactionSpec {
  return { effects: fadeMarks.of(null) };
}

/**
 * Undo one helper turn, if it is still intact: each of its ranges holds what
 * the helper wrote. Null when any has been edited since (or the turn is gone),
 * which is the card's cue to point at Ctrl+Z instead.
 */
export function helperUndoSpec(state: EditorState, turn: string): TransactionSpec | null {
  const marks = (state.field(helperMarks, false) ?? []).filter((m) => m.turn === turn);
  if (!marks.length) return null;
  if (marks.some((m) => state.sliceDoc(m.from, m.to) !== m.inserted)) return null;
  return {
    changes: marks.map((m) => ({ from: m.from, to: m.to, insert: m.original })),
    effects: dropTurn.of(turn),
    annotations: isolateHistory.of("full"),
    userEvent: "input.helper.undo",
  };
}
