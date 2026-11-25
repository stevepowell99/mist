import { describe, it, expect } from "vitest";
import { planHelperEdits, placedRanges, validHelperOps, type HelperOp } from "~/lib/helper-edits";

/** Apply planned changes to `doc` (offsets are in the original, so from the end). */
function apply(doc: string, ops: HelperOp[], mode: "edit" | "suggest" = "edit"): string {
  const { changes } = planHelperEdits(doc, ops, mode);
  let text = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}

describe("planHelperEdits: edit mode", () => {
  it("replaces only the words that differ", () => {
    const doc = "The cat sat on the mat.";
    const { changes } = planHelperEdits(doc, [{ op: "replace", find: "The cat sat", replace: "The dog sat" }], "edit");
    expect(changes).toEqual([{ from: 4, to: 7, insert: "dog", index: 0 }]);
    expect(apply(doc, [{ op: "replace", find: "The cat sat", replace: "The dog sat" }])).toBe("The dog sat on the mat.");
  });

  it("widens the changed span to whole words", () => {
    const doc = "This one is long, which is that.";
    const { changes } = planHelperEdits(doc, [{ op: "replace", find: doc, replace: "This one shows that." }], "edit");
    expect(changes).toHaveLength(1);
    expect(doc.slice(changes[0].from, changes[0].to)).toBe("is long, which is");
    expect(changes[0].insert).toBe("shows");
    expect(apply("The cat sat.", [{ op: "replace", find: "cat", replace: "cats" }], "suggest")).toBe("The {--cat--}{++cats++} sat.");
  });

  it("inserts after and before a passage, and deletes", () => {
    const doc = "One. Two. Three.";
    expect(apply(doc, [{ op: "insertAfter", find: "One.", text: " One and a half." }])).toBe("One. One and a half. Two. Three.");
    expect(apply(doc, [{ op: "insertBefore", find: "Two.", text: "Then " }])).toBe("One. Then Two. Three.");
    expect(apply(doc, [{ op: "delete", find: " Two." }])).toBe("One. Three.");
  });

  it("applies several edits from one reply against the same document", () => {
    const doc = "alpha beta gamma";
    expect(
      apply(doc, [
        { op: "replace", find: "gamma", replace: "GAMMA" },
        { op: "replace", find: "alpha", replace: "ALPHA" },
      ]),
    ).toBe("ALPHA beta GAMMA");
  });

  it("comments on a passage, and at the end with no find", () => {
    expect(apply("Some claim here.", [{ op: "comment", find: "claim", text: "source?" }])).toBe(
      "Some {==claim==}{>>source?<<} here.",
    );
    expect(apply("Text.", [{ op: "comment", text: "overall fine" }])).toBe("Text.\n\n{>>overall fine<<}");
  });

  it("works on text in any script", () => {
    expect(apply("我们今天开会。", [{ op: "replace", find: "今天", replace: "明天" }])).toBe("我们明天开会。");
  });
});

describe("planHelperEdits: skips rather than guesses", () => {
  it("skips a passage that is no longer there", () => {
    const { changes, outcomes } = planHelperEdits("The text was edited.", [{ op: "delete", find: "original wording" }], "edit");
    expect(changes).toEqual([]);
    expect(outcomes[0].applied).toBe(false);
    expect(outcomes[0].why).toMatch(/not in the document/);
  });

  it("skips a passage that occurs more than once", () => {
    const { changes, outcomes } = planHelperEdits("the and the", [{ op: "replace", find: "the", replace: "a" }], "edit");
    expect(changes).toEqual([]);
    expect(outcomes[0].why).toMatch(/more than once/);
  });

  it("skips an edit that overlaps an earlier one in the same reply", () => {
    const { changes, outcomes } = planHelperEdits(
      "one two three",
      [
        { op: "replace", find: "one two", replace: "1 2" },
        { op: "replace", find: "two three", replace: "2 3" },
      ],
      "edit",
    );
    expect(changes).toHaveLength(1);
    expect(outcomes.map((o) => o.applied)).toEqual([true, false]);
  });

  it("skips a replace that changes nothing", () => {
    expect(planHelperEdits("same", [{ op: "replace", find: "same", replace: "same" }], "edit").changes).toEqual([]);
  });
});

describe("planHelperEdits: suggest mode", () => {
  it("writes the changes as tracked changes", () => {
    expect(apply("The cat sat.", [{ op: "replace", find: "cat", replace: "dog" }], "suggest")).toBe("The {--cat--}{++dog++} sat.");
    expect(apply("A B", [{ op: "insertAfter", find: "A", text: " and" }], "suggest")).toBe("A{++ and++} B");
    expect(apply("A very long B", [{ op: "delete", find: " very long" }], "suggest")).toBe("A{-- very long--} B");
  });

  it("skips a change inside existing markup", () => {
    const { changes, outcomes } = planHelperEdits("A {++new words++} B", [{ op: "replace", find: "new words", replace: "other" }], "suggest");
    expect(changes).toEqual([]);
    expect(outcomes[0].why).toMatch(/tracked change or comment/);
  });
});

describe("placedRanges", () => {
  it("gives each change's range in the new document", () => {
    const doc = "aa bb cc";
    const { changes } = planHelperEdits(
      doc,
      [
        { op: "replace", find: "aa", replace: "AAAA" },
        { op: "replace", find: "cc", replace: "C" },
      ],
      "edit",
    );
    const next = apply(doc, [
      { op: "replace", find: "aa", replace: "AAAA" },
      { op: "replace", find: "cc", replace: "C" },
    ]);
    const ranges = placedRanges(changes);
    expect(ranges.map((r) => next.slice(r.from, r.to))).toEqual(changes.map((c) => c.insert));
  });
});

describe("validHelperOps", () => {
  it("keeps the five shapes and counts the rest", () => {
    const { ops, rejected } = validHelperOps([
      { op: "replace", find: "a", replace: "b" },
      { op: "comment", text: "note" },
      { op: "replace", find: "a" },
      { op: "explode", find: "a" },
      { op: "delete", find: "" },
      null,
    ]);
    expect(ops).toHaveLength(2);
    expect(rejected).toBe(4);
  });

  it("treats a missing edits list as none", () => {
    expect(validHelperOps(undefined)).toEqual({ ops: [], rejected: 0 });
  });
});
