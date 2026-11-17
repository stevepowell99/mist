import { EditorState, Transaction, Annotation } from "@codemirror/state";
import { criticSpans } from "./critic";

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
    // The deletion falls on existing markup (its delimiters, or text already
    // struck). Never edit a delimiter: that is what nests markup inside itself.
    const hit = criticSpans(doc).find(
      (s) => (s.type === "deletion" || s.type === "addition") && fromA >= s.from && toA <= s.to,
    );
    if (hit?.type === "deletion") {
      // Already struck: step right over the whole span, so the next key press
      // meets live text on the far side and merges into this deletion.
      return { changes: [], cursor: backward ? hit.from : hit.to };
    }
    if (hit) {
      // On an addition's delimiter. The delimiter is invisible in clean view, so
      // the key press is aimed at the nearest character in that direction.
      const inOpener = toA <= hit.contentFrom;
      const target = backward
        ? inOpener
          ? hit.from - 1 // before the addition: the character ahead of it
          : hit.contentTo - 1 // after it: the addition's own last character
        : inOpener
          ? hit.contentFrom // before it: the addition's own first character
          : hit.to; // after it: the character behind it
      if (target < 0 || target >= doc.length) return { changes: [], cursor: backward ? fromA : toA };
      // Null means "delete it plainly" (inside the addition), which here must be
      // spelt out: passing the original edit through would delete the delimiter.
      return (
        suggestEdit(doc, target, target + 1, "", backward) ?? {
          changes: [{ from: target, to: target + 1, insert: "" }],
          cursor: target,
        }
      );
    }
    const around = strikeAround(doc, fromA, toA, "", backward);
    if (around) return around;
    const leftMerge = doc.slice(fromA - 3, fromA) === "--}";
    const rightMerge = doc.slice(toA, toA + 3) === "{--";
    const open = leftMerge ? "" : "{--";
    const close = rightMerge ? "" : "--}";
    const start = leftMerge ? fromA - 3 : fromA;
    const end = rightMerge ? toA + 3 : toA;
    const insert = `${open}${deleted}${close}`;
    // Leave the cursor outside the deletion, on the side the key was heading:
    // Backspace before it, Delete after it. Inside, the next press would land
    // on a delimiter.
    const next = doc.slice(0, start) + insert + doc.slice(end);
    const span = criticSpans(next).find((s) => s.type === "deletion" && start >= s.from && start < s.to);
    const spanFrom = span?.from ?? start;
    const spanTo = span?.to ?? start + insert.length;
    return {
      changes: [{ from: start, to: end, insert }],
      cursor: backward ? spanFrom : spanTo,
    };
  }

  // Replace a selection with typed/pasted text: strike the old, add the new.
  if (deleting && inserting) {
    if (additionContaining(doc, fromA, toA)) return null; // replace inside an addition
    const around = strikeAround(doc, fromA, toA, insert, backward);
    if (around) return around;
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

/**
 * A deletion or replacement whose range crosses existing CriticMarkup. The
 * delimiters are hidden in clean view, so a selection can run across a tracked
 * change or a comment unseen, and wrapping the whole range would put markup
 * inside markup and break both. Strike only the live text between the spans it
 * touches and leave those spans as they are; a replacement's new text goes in
 * after the range. Null when the range touches no markup.
 */
function strikeAround(doc: string, fromA: number, toA: number, insert: string, backward: boolean): SuggestResult | null {
  const spans = criticSpans(doc).filter((s) => s.from < toA && s.to > fromA);
  if (!spans.length) return null;
  const changes: SuggestChange[] = [];
  let pos = fromA;
  for (const s of spans) {
    if (pos < s.from) changes.push({ from: pos, to: s.from, insert: `{--${doc.slice(pos, s.from)}--}` });
    pos = Math.max(pos, s.to);
  }
  if (pos < toA) changes.push({ from: pos, to: toA, insert: `{--${doc.slice(pos, toA)}--}` });
  const start = Math.min(fromA, spans[0].from);
  const end = Math.max(toA, pos);
  const grown = changes.length * 6;
  if (insert) {
    changes.push({ from: end, to: end, insert: `{++${insert}++}` });
    return { changes, cursor: end + grown + 3 + insert.length };
  }
  return { changes, cursor: backward ? start : end + grown };
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
    // Typing, Enter, pasting and deleting become suggestions; formatting wraps
    // ("input.wrap") and programmatic edits (no user event) pass through.
    // A bare "input" is the Enter key (insertNewlineAndIndent), "input.drop" a
    // dragged-in text: both are this user's own insertions.
    const handled =
      !!ue &&
      (ue === "input" ||
        ue.startsWith("input.type") ||
        ue === "input.paste" ||
        ue === "input.drop" ||
        ue.startsWith("delete"));
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
