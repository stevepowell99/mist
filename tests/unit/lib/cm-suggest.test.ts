import { describe, it, expect } from "vitest";
import { suggestEdit, type SuggestResult } from "~/lib/cm-suggest";
import { criticSpans, spanContentAt } from "~/lib/cm-criticmarkup";

/** Apply a suggestEdit result to `doc` and return the resulting text + cursor,
 *  with the cursor shown as a `|` marker for readable assertions. */
function apply(doc: string, res: SuggestResult | null): string {
  if (!res) return "(null)";
  let text = doc;
  // single change (or none) in these cases; apply on original offsets
  for (const c of res.changes) {
    text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  }
  return text.slice(0, res.cursor) + "|" + text.slice(res.cursor);
}

describe("suggestEdit: insertion", () => {
  it("wraps a typed char in an addition", () => {
    expect(apply("", suggestEdit("", 0, 0, "a", false))).toBe("{++a|++}");
  });

  it("extends the addition when the cursor is already inside it", () => {
    // "{++a|++}", type 'b' at offset 4 (between content and close delimiter):
    // null lets the plain insert through, which extends the addition in place.
    expect(suggestEdit("{++a++}", 4, 4, "b", false)).toBeNull();
  });

  it("extends a preceding addition when typing right after it", () => {
    // cursor at the very end of "{++a++}" (offset 7)
    expect(apply("{++a++}", suggestEdit("{++a++}", 7, 7, "b", false))).toBe("{++ab|++}");
  });

  it("leaves plain text alone elsewhere (new wrapper)", () => {
    expect(apply("hello world", suggestEdit("hello world", 5, 5, "X", false))).toBe(
      "hello{++X|++} world",
    );
  });
});

describe("suggestEdit: deletion", () => {
  it("wraps a backspaced char as a deletion, cursor before it", () => {
    // "abc", cursor after 'c' (offset 3), backspace deletes [2,3)
    expect(apply("abc", suggestEdit("abc", 2, 3, "", true))).toBe("ab{--|c--}");
  });

  it("merges with an adjacent preceding deletion", () => {
    // "a{--c--}" with cursor before the deletion at offset 1; backspace 'a' [0,1)
    expect(apply("a{--c--}", suggestEdit("a{--c--}", 0, 1, "", true))).toBe("{--|ac--}");
  });

  it("does a plain delete inside an addition", () => {
    // "{++abc++}", delete 'b' at [4,5): inside the addition content -> null (plain)
    expect(suggestEdit("{++abc++}", 4, 5, "", true)).toBeNull();
  });

  it("removes the whole wrapper when the last addition char is deleted", () => {
    // "{++a++}", delete the only content char 'a' at [3,4)
    expect(apply("{++a++}", suggestEdit("{++a++}", 3, 4, "", true))).toBe("|");
  });

  it("steps over an already-struck char instead of re-deleting", () => {
    // "{--c--}", backspace targeting content 'c' at [3,4)
    expect(suggestEdit("{--c--}", 3, 4, "", true)).toEqual({ changes: [], cursor: 3 });
  });

  it("wraps a deleted selection of plain text", () => {
    expect(apply("hello world", suggestEdit("hello world", 0, 5, "", true))).toBe(
      "{--|hello--} world",
    );
  });
});

describe("suggestEdit: replace selection", () => {
  it("strikes the old text and adds the new", () => {
    expect(apply("cat", suggestEdit("cat", 0, 3, "dog", false))).toBe("{--cat--}{++dog|++}");
  });

  it("replaces plainly inside an addition", () => {
    expect(suggestEdit("{++cat++}", 3, 6, "dog", false)).toBeNull();
  });
});

describe("suggestEdit: paste guard", () => {
  it("does not re-wrap a payload that already has CriticMarkup", () => {
    expect(suggestEdit("x", 1, 1, "{++already++}", false)).toBeNull();
  });
});

describe("criticSpans", () => {
  it("parses all five span types with correct offsets", () => {
    const text = "{++add++} {--del--} {==hi==} {>>note<<} {~~old~>new~~}";
    const spans = criticSpans(text);
    expect(spans.map((s) => s.type)).toEqual([
      "addition",
      "deletion",
      "highlight",
      "comment",
      "substitution",
    ]);
    const add = spans[0];
    expect(text.slice(add.contentFrom, add.contentTo)).toBe("add");
    const sub = spans[4];
    expect(text.slice(sub.contentFrom, sub.sep!.from)).toBe("old");
    expect(text.slice(sub.sep!.to, sub.contentTo)).toBe("new");
  });

  it("finds the span whose content contains a position", () => {
    const spans = criticSpans("{++abc++}");
    expect(spanContentAt(spans, 4)?.type).toBe("addition");
    expect(spanContentAt(spans, 0)).toBeNull();
  });
});
