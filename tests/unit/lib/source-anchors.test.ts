import { describe, it, expect } from "vitest";
import { insertPosAnchors } from "~/lib/source-anchors";

const positions = (out: string) =>
  [...out.matchAll(/data-pos="(\d+)"/g)].map((m) => Number(m[1]));

describe("insertPosAnchors", () => {
  it("marks every top-level block with its source offset", () => {
    const md = "# Title\n\nOne.\n\nTwo.\n";
    const out = insertPosAnchors(md);
    expect(positions(out)).toEqual([0, md.indexOf("One."), md.indexOf("Two.")]);
  });

  it("adds the base offset, so the numbers are editor-document positions", () => {
    expect(positions(insertPosAnchors("Body.\n", 40))).toEqual([40]);
  });

  it("treats a fenced block as one block and never marks inside it", () => {
    const md = "Text.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.\n";
    const out = insertPosAnchors(md);
    expect(positions(out)).toEqual([0, md.indexOf("```js"), md.indexOf("After.")]);
    expect(out).toContain("const a = 1;\n\nconst b = 2;");
  });

  it("keeps a loose list whole, so a marker cannot split it into two lists", () => {
    const md = "- one\n\n- two\n\n- three\n";
    expect(positions(insertPosAnchors(md))).toEqual([0]);
  });

  it("marks each paragraph, not just each heading (the point of the change)", () => {
    const md = "## H\n\nP1.\n\nP2.\n\nP3.\n";
    expect(positions(insertPosAnchors(md))).toHaveLength(4);
  });

  it("never lets a marker interrupt a paragraph", () => {
    // A fence hard against the paragraph above it: the marker needs a blank line
    // before it, or markdown folds it into the text as an inline <br>.
    const out = insertPosAnchors("Para.\n```\ncode\n```\n");
    expect(out).toContain("Para.\n\n<br data-pos=");
  });
});
