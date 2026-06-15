import { EditorState, Transaction, Annotation } from "@codemirror/state";
import { criticSpans } from "./cm-criticmarkup";

/**
 * Suggest mode for the CodeMirror 6 / Y.Text core (#13). In the text model a
 * suggestion is literal CriticMarkup: an insertion becomes `{++text++}`, a
 * deletion wraps the text in `{--...--}`. This mirrors the old TipTap
 * mark-based `suggest-mode.ts`, but produces text edits instead of marks, which
 * is what makes the round-trip an identity.
 *
 * The core is the pure `suggestEdit`, unit-tested in isolation; the CodeMirror
 * extension just intercepts user-event transactions and rewrites them through
 * it. Adjacent same-type runs (e.g. two backspaces in a row) are merged so the
 * markup stays tidy: `{--a--}{--b--}` would render two spans, so we splice the
 * touching delimiters instead.
 */

export interface SuggestChange {
  from: number;
  to: number;
  insert: string;
}
export interface SuggestResult {
  changes: SuggestChange[];
  cursor: number;
}

const DELIM_RE = /\{\+\+|\+\+\}|\{--|--\}|\{~~|~~\}|\{==|==\}|\{>>|<<\}/;

/** The addition span whose content contains `pos` (boundaries inclusive). */
function additionAt(doc: string, pos: number) {
  return (
    criticSpans(doc).find(
      (s) => s.type === "addition" && pos >= s.contentFrom && pos <= s.contentTo,
    ) ?? null
  );
}
function deletionContaining(doc: string, from: number, to: number) {
  return (
    criticSpans(doc).find(
      (s) => s.type === "deletion" && from >= s.contentFrom && to <= s.contentTo,
    ) ?? null
  );
}
function additionContaining(doc: string, from: number, to: number) {
  return (
    criticSpans(doc).find(
      (s) => s.type === "addition" && from >= s.contentFrom && to <= s.contentTo,
    ) ?? null
  );
}

/**
 * Rewrite a single user edit (delete [fromA,toA), insert `insert`) into the
 * CriticMarkup-producing edit for suggest mode. Returns null to let the
 * original edit pass unchanged (e.g. typing inside an existing addition, which
 * just extends it).
 */
export function suggestEdit(
  doc: string,
  fromA: number,
  toA: number,
  insert: string,
  backward: boolean,
): SuggestResult | null {
  const deleting = toA > fromA;
  const inserting = insert.length > 0;

  // Never rewrite a payload that already contains CriticMarkup delimiters
  // (e.g. pasting an already-suggested passage); pass it through untouched.
  if (inserting && DELIM_RE.test(insert)) return null;

  // Pure insertion (typing or plain paste).
  if (!deleting && inserting) {
    if (additionAt(doc, fromA)) return null; // inside an addition: extend plainly
    if (doc.slice(fromA - 3, fromA) === "++}") {
      // touching the end of a previous addition: extend it
      return {
        changes: [{ from: fromA - 3, to: fromA, insert: `${insert}++}` }],
        cursor: fromA - 3 + insert.length,
      };
    }
    return {
      changes: [{ from: fromA, to: fromA, insert: `{++${insert}++}` }],
      cursor: fromA + 3 + insert.length,
    };
  }

  // Pure deletion (backspace, forward delete, or deleting a selection).
  if (deleting && !inserting) {
    const deleted = doc.slice(fromA, toA);
    const inAdd = additionContaining(doc, fromA, toA);
    if (inAdd) {
      if (fromA === inAdd.contentFrom && toA === inAdd.contentTo) {
        // removing all of an addition's content: drop the whole wrapper
        return { changes: [{ from: inAdd.from, to: inAdd.to, insert: "" }], cursor: inAdd.from };
      }
      return null; // shrink the addition with a plain delete
    }
    if (deletionContaining(doc, fromA, toA)) {
      // already struck: don't re-delete, just step the cursor over it
      return { changes: [], cursor: backward ? fromA : toA };
    }
    const leftMerge = doc.slice(fromA - 3, fromA) === "--}";
    const rightMerge = doc.slice(toA, toA + 3) === "{--";
    const open = leftMerge ? "" : "{--";
    const close = rightMerge ? "" : "--}";
    const start = leftMerge ? fromA - 3 : fromA;
    const end = rightMerge ? toA + 3 : toA;
    return {
      changes: [{ from: start, to: end, insert: `${open}${deleted}${close}` }],
      cursor: backward ? start + open.length : start + open.length + deleted.length,
    };
  }

  // Replace a selection with typed/pasted text: strike the old, add the new.
  if (deleting && inserting) {
    if (additionContaining(doc, fromA, toA)) return null; // replace inside an addition
    const deleted = doc.slice(fromA, toA);
    const leftMerge = doc.slice(fromA - 3, fromA) === "--}";
    const open = leftMerge ? "" : "{--";
    const start = leftMerge ? fromA - 3 : fromA;
    const replacement = `${open}${deleted}--}{++${insert}++}`;
    return {
      changes: [{ from: start, to: toA, insert: replacement }],
      cursor: start + open.length + deleted.length + 6 + insert.length,
    };
  }

  return null;
}

const processed = Annotation.define<boolean>();

/**
 * CodeMirror extension. `getMode` returns the live mode; only "suggest"
 * rewrites edits. Remote (collab) and programmatic changes carry no user event
 * and pass through untouched, so suggestion wrapping only ever applies to this
 * user's own typing and deleting.
 */
export function suggestMode(getMode: () => "edit" | "suggest") {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.annotation(processed)) return tr;
    if (!tr.docChanged || getMode() !== "suggest") return tr;
    const ue = tr.annotation(Transaction.userEvent);
    // Typing, pasting and deleting become suggestions; formatting wraps
    // ("input.wrap") and programmatic edits (no user event) pass through.
    const handled = !!ue && (ue.startsWith("input.type") || ue === "input.paste" || ue.startsWith("delete"));
    if (!handled) return tr;

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
    if (count !== 1) return tr; // multi-range edits fall through

    const backward = !ue.startsWith("delete.forward");
    const res = suggestEdit(tr.startState.doc.toString(), fromA, toA, insert, backward);
    if (!res) return tr;

    return {
      changes: res.changes,
      selection: { anchor: res.cursor },
      scrollIntoView: true,
      userEvent: ue,
      annotations: processed.of(true),
    };
  });
}
