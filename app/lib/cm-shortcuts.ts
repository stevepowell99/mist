import { EditorState, EditorSelection, Prec, Transaction, type ChangeSpec } from "@codemirror/state";
import { keymap, type Command } from "@codemirror/view";

/**
 * Editor conveniences for the CodeMirror 6 / Y.Text core, ported from the
 * TipTap `markdown-shortcuts.ts`. mist stores plain markdown, so "bold" wraps
 * the selection in literal `**`, not a WYSIWYG mark.
 *
 * - Mod-B / Mod-I wrap each selection (or drop empty markers) in `**` / `*`.
 * - Typing a wrapping char over a non-empty selection wraps it instead of
 *   replacing: `*` `_` `` ` `` (emphasis/code), `=` -> `==highlight==`, and the
 *   bracket and quote pairs.
 *
 * Both dispatch with the "input.wrap" user event so suggest mode leaves the
 * markers as a plain formatting edit rather than wrapping them as a suggestion.
 */

const WRAP_PAIRS: Record<string, [string, string]> = {
  "*": ["*", "*"],
  _: ["_", "_"],
  "`": ["`", "`"],
  "=": ["==", "=="],
  '"': ['"', '"'],
  "'": ["'", "'"],
  "(": ["(", ")"],
  "[": ["[", "]"],
  "{": ["{", "}"],
};

/** Wrap every selection range with open/close, keeping the text selected. */
function wrap(open: string, close: string): Command {
  return (view) => {
    const changes: ChangeSpec[] = [];
    const ranges = view.state.selection.ranges.map((r) => {
      changes.push({ from: r.from, insert: open });
      changes.push({ from: r.to, insert: close });
      // After inserting `open` before and `close` after, the content shifts by
      // open.length; keep the original text selected (empty stays a cursor
      // between the markers).
      return EditorSelection.range(r.from + open.length, r.to + open.length);
    });
    view.dispatch(
      view.state.update({
        changes,
        selection: EditorSelection.create(ranges),
        scrollIntoView: true,
        userEvent: "input.wrap",
      }),
    );
    return true;
  };
}

export const wrapKeymap = keymap.of([
  { key: "Mod-b", run: wrap("**", "**") },
  { key: "Mod-i", run: wrap("*", "*") },
]);

/** Typing a wrapping char over a non-empty selection wraps it instead of
 *  replacing. High precedence so it pre-empts suggest mode (which would
 *  otherwise strike the selection and add the char). */
export const wrapOnSelection = Prec.highest(
  EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const ue = tr.annotation(Transaction.userEvent);
    if (ue !== "input.type") return tr;

    let fromA = -1;
    let toA = -1;
    let insert = "";
    let count = 0;
    tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
      fromA = fA;
      toA = tA;
      insert = ins.toString();
      count++;
    });
    if (count !== 1 || toA <= fromA) return tr; // need a single replaced selection
    const pair = WRAP_PAIRS[insert];
    if (!pair) return tr;

    const [open, close] = pair;
    const selected = tr.startState.doc.sliceString(fromA, toA);
    return {
      changes: [{ from: fromA, to: toA, insert: `${open}${selected}${close}` }],
      selection: { anchor: fromA + open.length, head: fromA + open.length + selected.length },
      scrollIntoView: true,
      userEvent: "input.wrap",
    };
  }),
);
