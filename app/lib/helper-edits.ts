import { criticSpans } from "./critic";
import { insertCommentChange } from "./cm-comments";

/**
 * The helper's edits, as the model returns them, turned into changes to the
 * document as it stands when the reply arrives.
 *
 * Each edit names its passage by text, never by offset: the reply takes ten to
 * thirty seconds, the user may type meanwhile, and an offset computed against
 * the text that was sent would land on the wrong words. So every `find` is
 * looked up in the current document. Missing means the passage changed while
 * the model was thinking; more than once means the anchor does not say which
 * one was meant. Either way the edit is skipped and reported, never guessed.
 *
 * The vocabulary is `scripts/gmist-bot.mjs`'s, so a model that has learnt one
 * has learnt both. Pure: no editor, so it tests without a DOM.
 */
export type HelperOp =
  | { op: "replace"; find: string; replace: string }
  | { op: "insertAfter"; find: string; text: string }
  | { op: "insertBefore"; find: string; text: string }
  | { op: "delete"; find: string }
  | { op: "comment"; find?: string; text: string };

/** A change in the coordinates of the document it was planned against. */
export interface HelperChange {
  from: number;
  to: number;
  insert: string;
  /** Which op it came from, so the card can point at it. */
  index: number;
}

export interface HelperOutcome {
  op: HelperOp;
  applied: boolean;
  /** Why it was skipped, for the card. */
  why?: string;
  /** What went and what came, for the card's diff. */
  removed?: string;
  added?: string;
}

/** The five ops, the one list both this check and the reply schema read. */
export const HELPER_OPS = ["replace", "insertAfter", "insertBefore", "delete", "comment"] as const;
const OPS = new Set<string>(HELPER_OPS);

/**
 * Keep only edits whose shape is one of the five ops. Anything else the model
 * returned is counted, so the card can say some of the reply was not usable
 * rather than dropping it without a word.
 */
export function validHelperOps(raw: unknown): { ops: HelperOp[]; rejected: number } {
  if (!Array.isArray(raw)) return { ops: [], rejected: raw == null ? 0 : 1 };
  const ops: HelperOp[] = [];
  let rejected = 0;
  for (const e of raw) {
    const o = e as Record<string, unknown> | null;
    const str = (k: string) => typeof o?.[k] === "string";
    const ok =
      !!o &&
      typeof o.op === "string" &&
      OPS.has(o.op) &&
      (o.op === "comment" ? str("text") && (o.find === undefined || str("find")) : str("find") && (o.find as string).length > 0) &&
      (o.op !== "replace" || str("replace")) &&
      (o.op !== "insertAfter" && o.op !== "insertBefore" ? true : str("text"));
    if (ok) ops.push(o as unknown as HelperOp);
    else rejected++;
  }
  return { ops, rejected };
}

function occurrences(doc: string, find: string): number[] {
  const at: number[] = [];
  for (let i = doc.indexOf(find); i >= 0 && at.length < 2; i = doc.indexOf(find, i + 1)) at.push(i);
  return at;
}

/**
 * The span of `before` that differs from `after`, so a rewrite touches only the
 * words that changed and the cursor survives. Widened to whitespace either
 * side, so the highlight and the tracked change cover whole words ("is" to
 * "shows", not "i" to "show"). Text without spaces between words simply keeps
 * the wider span: the change is the same, only its highlight is larger.
 */
function trim(before: string, after: string): { head: number; tail: number } {
  let head = 0;
  const max = Math.min(before.length, after.length);
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const space = (c: string | undefined) => c === undefined || /\s/.test(c);
  while (head > 0 && !space(before[head - 1])) head--;
  while (tail > 0 && !space(before[before.length - tail])) tail--;
  return { head, tail };
}

/** CriticMarkup for one change, as Suggesting mode would write it. */
function tracked(removed: string, added: string): string {
  return (removed ? `{--${removed}--}` : "") + (added ? `{++${added}++}` : "");
}

/**
 * Plan the edits against `doc`. Every op is located in the same `doc`, so the
 * changes can go into one transaction (CodeMirror wants them all in the start
 * document's coordinates); an op that would overlap an earlier one is skipped.
 * In Suggesting mode the changes are written as tracked changes, and a change
 * that would land inside an existing tracked change or comment is skipped,
 * since nesting CriticMarkup corrupts both.
 */
export function planHelperEdits(
  doc: string,
  ops: HelperOp[],
  mode: "edit" | "suggest",
): { changes: HelperChange[]; outcomes: HelperOutcome[] } {
  const changes: HelperChange[] = [];
  const outcomes: HelperOutcome[] = [];
  const spans = mode === "suggest" ? criticSpans(doc) : [];
  // An insertion strictly inside a replaced span counts as overlapping it; one
  // at either edge does not, and two at the same point keep their reply order.
  const taken = (from: number, to: number) => changes.some((c) => from < c.to && to > c.from);
  const inMarkup = (from: number, to: number) => spans.some((s) => from < s.to && to > s.from);

  ops.forEach((op, index) => {
    const skip = (why: string) => outcomes.push({ op, applied: false, why });

    if (op.op === "comment" && !op.find) {
      const insert = `\n\n{>>${op.text}<<}`;
      changes.push({ from: doc.length, to: doc.length, insert, index });
      outcomes.push({ op, applied: true, added: op.text });
      return;
    }

    const find = op.find as string;
    const at = occurrences(doc, find);
    if (at.length === 0) return skip("its passage is not in the document now (changed since you asked?)");
    if (at.length > 1) return skip("its passage occurs more than once, so it could not tell which was meant");
    const start = at[0];
    const end = start + find.length;

    let change: { from: number; to: number; insert: string };
    let removed = "";
    let added = "";
    switch (op.op) {
      case "comment": {
        const c = insertCommentChange(doc, start, end, op.text).changes[0];
        change = c;
        added = op.text;
        break;
      }
      case "insertAfter":
      case "insertBefore": {
        const pos = op.op === "insertAfter" ? end : start;
        added = op.text;
        change = { from: pos, to: pos, insert: mode === "suggest" ? tracked("", added) : added };
        break;
      }
      case "delete":
        removed = find;
        change = { from: start, to: end, insert: mode === "suggest" ? tracked(removed, "") : "" };
        break;
      case "replace": {
        if (op.replace === find) return skip("it would not change anything");
        const { head, tail } = trim(find, op.replace);
        removed = find.slice(head, find.length - tail);
        added = op.replace.slice(head, op.replace.length - tail);
        const from = start + head;
        const to = end - tail;
        change = { from, to, insert: mode === "suggest" ? tracked(removed, added) : added };
        break;
      }
    }

    if (mode === "suggest" && op.op !== "comment" && inMarkup(change.from, change.to)) {
      return skip("it falls inside an existing tracked change or comment");
    }
    if (taken(change.from, change.to)) return skip("it overlaps another change in the same reply");
    changes.push({ ...change, index });
    outcomes.push({ op, applied: true, removed: op.op === "replace" ? find : removed, added: op.op === "replace" ? op.replace : added });
  });

  changes.sort((a, b) => a.from - b.from || a.index - b.index);
  return { changes, outcomes };
}

/**
 * Where each planned change sits once the transaction is applied, in the new
 * document's coordinates. Exact because the changes are sorted and do not
 * overlap: each moves the ones after it by its own change in length.
 */
export function placedRanges(changes: HelperChange[]): { from: number; to: number; index: number }[] {
  let delta = 0;
  return changes.map((c) => {
    const from = c.from + delta;
    delta += c.insert.length - (c.to - c.from);
    return { from, to: from + c.insert.length, index: c.index };
  });
}
