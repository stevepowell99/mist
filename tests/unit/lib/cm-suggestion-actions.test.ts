import { describe, it, expect } from "vitest";
import {
  hasSuggestions,
  isCursorInSuggestion,
  resolveAtCursor,
  resolveAll,
  type TextChange,
} from "~/lib/cm-suggestion-actions";
import { extractOutlineFromText } from "~/lib/outline";

function apply(text: string, change: TextChange | null): string {
  if (!change) return "(null)";
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}
function applyAll(text: string, changes: TextChange[]): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

describe("cm-suggestion-actions", () => {
  it("detects suggestions and the cursor being in one", () => {
    expect(hasSuggestions("a {++b++} c")).toBe(true);
    expect(hasSuggestions("a {==hl==} c")).toBe(false); // highlight is not a suggestion
    expect(isCursorInSuggestion("a {++b++} c", 5)).toBe(true);
    expect(isCursorInSuggestion("a {++b++} c", 0)).toBe(false);
  });

  it("accepts and rejects an addition", () => {
    expect(apply("x {++new++} y", resolveAtCursor("x {++new++} y", 6, true))).toBe("x new y");
    expect(apply("x {++new++} y", resolveAtCursor("x {++new++} y", 6, false))).toBe("x  y");
  });

  it("accepts and rejects a deletion", () => {
    expect(apply("x {--old--} y", resolveAtCursor("x {--old--} y", 6, true))).toBe("x  y");
    expect(apply("x {--old--} y", resolveAtCursor("x {--old--} y", 6, false))).toBe("x old y");
  });

  it("accepts new / rejects old for a substitution", () => {
    const t = "x {~~old~>new~~} y";
    const at = t.indexOf("old");
    expect(apply(t, resolveAtCursor(t, at, true))).toBe("x new y");
    expect(apply(t, resolveAtCursor(t, at, false))).toBe("x old y");
  });

  it("resolves all suggestions at once, leaving highlights/comments", () => {
    const t = "{++a++} keep {==hl==}{>>c<<} {--b--}";
    expect(applyAll(t, resolveAll(t, true))).toBe("a keep {==hl==}{>>c<<} ");
  });
});

describe("extractOutlineFromText", () => {
  it("reads heading levels, titles, offsets and hidden state", () => {
    const text = "# One\n\nsome body\n\n## Two {visibility=\"hidden\"}\n\n### Three";
    const items = extractOutlineFromText(text);
    expect(items.map((i) => [i.level, i.title, i.hidden])).toEqual([
      [1, "One", false],
      [2, "Two", true],
      [3, "Three", false],
    ]);
    // pos points at the start of each heading line
    expect(text.slice(items[2].pos, items[2].pos + 3)).toBe("###");
  });
});
