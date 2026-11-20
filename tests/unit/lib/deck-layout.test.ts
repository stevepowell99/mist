import { describe, it, expect } from "vitest";
import { buildSlideSections, deckSlideLayout, shownSlides } from "~/lib/slides-build";
import {
  deckIndexForOffset,
  deckSlideAt,
  fragmentIndexForOffset,
  offsetForDeckIndex,
  slideIndexForOffset,
} from "~/lib/slide-cursor";

/** The deck renders without hidden slides, so the editor's mapping must skip
 *  them too, or every slide after one is off by one. */
const md = [
  "---",
  "format: revealjs",
  "---",
  "",
  "## One",
  "",
  "first",
  "",
  '## Two {visibility="hidden"}',
  "",
  "secret",
  "",
  "## Three",
  "",
  "third",
  "",
  "## Four {.hidden}",
  "",
  "gone",
  "",
  "## Five",
  "",
  "fifth",
].join("\n");

const at = (needle: string) => md.indexOf(needle);
const sections = (src: string) =>
  (buildSlideSections(src, { drive: null, origin: "", driveToken: "", bust: "", docFrontmatter: "" }).match(/<section[^>]*data-markdown/g) ?? [])
    .length;

describe("deck index skips hidden slides", () => {
  it("counts the deck's slides, not the source's", () => {
    expect(deckIndexForOffset(md, at("first"))).toBe(0);
    expect(deckIndexForOffset(md, at("third"))).toBe(1);
    expect(deckIndexForOffset(md, at("fifth"))).toBe(2);
    expect(sections(md)).toBe(3);
  });

  it("keeps the deck on the shown slide before a hidden one the cursor is in", () => {
    expect(deckIndexForOffset(md, at("secret"))).toBe(0);
    expect(deckIndexForOffset(md, at("gone"))).toBe(1);
    expect(deckSlideAt(deckSlideLayout(md), at("secret"))?.hidden).toBe(true);
  });

  it("maps a deck index back to the first line of that shown slide", () => {
    expect(offsetForDeckIndex(md, 0)).toBe(at("## One"));
    expect(offsetForDeckIndex(md, 1)).toBe(at("## Three"));
    expect(offsetForDeckIndex(md, 2)).toBe(at("## Five"));
    expect(offsetForDeckIndex(md, 3)).toBeNull();
  });

  it("leaves the source index counting every slide, for the library", () => {
    expect(slideIndexForOffset(md, at("secret"))).toBe(1);
    expect(slideIndexForOffset(md, at("fifth"))).toBe(4);
  });

  it("gives no fragment in a hidden slide", () => {
    const f = "## A\n\nx\n\n## B {.hidden}\n\n::: {.fragment}\ny\n:::\n";
    expect(fragmentIndexForOffset(f, f.indexOf("y"))).toBe(-1);
  });

  it("names and numbers only the shown slides for the speaker notes", () => {
    expect(shownSlides(md).map((s) => s.title)).toEqual(["One", "Three", "Five"]);
  });

  it("drops a stack whose slides are all hidden instead of leaving a blank slide", () => {
    const src = "## A\n\na\n\n# B {.hidden}\n\n## C {.hidden}\n\nc\n\n## D\n";
    expect(sections(src)).toBe(2);
    expect(buildSlideSections(src, { drive: null, origin: "", driveToken: "", bust: "", docFrontmatter: "" })).not.toMatch(
      /<section>\s*<\/section>/,
    );
  });
});

describe("deck layout follows what the deck builds from", () => {
  it("does not count a slide that is all a suggested deletion", () => {
    const src = "## A\n\na\n\n{--## Cut\n\ncut--}\n\n## B\n\nb\n";
    expect(deckIndexForOffset(src, src.indexOf("b\n"))).toBe(1);
    expect(offsetForDeckIndex(src, 1)).toBe(src.indexOf("## B"));
  });

  it("counts a suggested new slide", () => {
    // The addition opens on the heading line, so the raw source does not split there.
    const src = "## A\n\na\n\n{++## New\n\nnew++}\n\n## B\n\nb\n";
    expect(slideIndexForOffset(src, src.indexOf("b\n"))).toBe(1);
    expect(deckIndexForOffset(src, src.indexOf("new++"))).toBe(1);
    expect(deckIndexForOffset(src, src.indexOf("b\n"))).toBe(2);
    expect(offsetForDeckIndex(src, 1)).toBe(src.indexOf("## New"));
  });

  it("does not count a slide that holds only a style block", () => {
    const src = "<style>\n.x { color: red }\n</style>\n\n## A\n\na\n";
    expect(deckIndexForOffset(src, src.indexOf("a\n"))).toBe(0);
    expect(offsetForDeckIndex(src, 0)).toBe(src.indexOf("## A"));
  });
});
