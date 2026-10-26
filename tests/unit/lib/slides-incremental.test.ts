// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { marked } from "marked";
import { buildSlideSections } from "~/lib/slides-build";
import { markIncremental } from "~/lib/slides-runtime";
import { fragmentIndexForOffset } from "~/lib/slide-cursor";

// Build a one-slide deck through the real grammar pipeline, render each
// data-markdown section the way reveal's markdown plugin does, then apply the
// deck's .incremental rule. Returns the slide's section element.
function renderSlide(md: string): Element {
  const host = document.createElement("div");
  host.innerHTML = buildSlideSections(md, {
    drive: null,
    origin: "https://mist.example",
    driveToken: "TOK",
    bust: "1",
    docFrontmatter: "",
  });
  for (const section of Array.from(host.querySelectorAll("section[data-markdown]"))) {
    const text = section.querySelector("textarea")?.value ?? "";
    section.innerHTML = marked.parse(text, { async: false });
  }
  markIncremental(host);
  return host.querySelector("section")!;
}

const domFragments = (md: string) => renderSlide(md).querySelectorAll(".fragment").length;
// The cursor follow's count over the whole slide: the index of its last fragment, plus one.
const sourceFragments = (md: string) => fragmentIndexForOffset(md, md.length) + 1;

const wholeSlide = [
  "## Title {.incremental}",
  "",
  "Intro paragraph",
  "over two lines.",
  "",
  "- one",
  "- two",
  "  - nested",
  "- three",
  "",
  "![](https://example.com/y.png)",
  "",
  "::: {.panel}",
  "inside",
  ":::",
  "",
  "```js",
  "code",
  "",
  "more",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "### Sub heading",
  "",
  "> [!note] Callout",
  "> body",
  "",
  "::: {.notes}",
  "notes here",
  ":::",
].join("\n");

const quartoDiv = ["## Plain", "", "Shown at once.", "", "::: {.incremental}", "- a", "- b", ":::"].join("\n");

const looseList = ["## T {.incremental}", "", "- a", "", "- b", "", "  continued", "", "Para after."].join("\n");

const mixed = [
  "## T {.incremental}",
  "",
  "::: {.nonincremental}",
  "- shown",
  "- together",
  ":::",
  "",
  "::: {.fragment}",
  "explicit",
  ":::",
  "",
  "[span]{.fragment} in a paragraph",
  "",
  "::: {.columns .incremental}",
  "::: {.panel}",
  "col one",
  ":::",
  "::: {.panel}",
  "col two",
  ":::",
  ":::",
].join("\n");

const divider = ["# Part {.incremental}", "", "- x", "- y"].join("\n");

describe(".incremental in the deck", () => {
  it("makes every block after the title a fragment, a list one per item", () => {
    const s = renderSlide(wholeSlide);
    expect(s.querySelector("h2")!.classList.contains("fragment")).toBe(false);
    expect(s.querySelector("ul")!.classList.contains("fragment")).toBe(false);
    expect(Array.from(s.querySelectorAll(":scope > ul > li")).every((li) => li.classList.contains("fragment"))).toBe(true);
    expect(s.querySelector("aside.notes")!.classList.contains("fragment")).toBe(false);
    // intro, three items, image, panel, code, table, sub heading, callout
    expect(domFragments(wholeSlide)).toBe(10);
  });

  it("on a Quarto div, makes each list item a fragment and leaves the slide alone", () => {
    expect(domFragments(quartoDiv)).toBe(2);
    expect(renderSlide(quartoDiv).querySelector(":scope > p")!.classList.contains("fragment")).toBe(false);
  });

  it("respects .nonincremental, existing fragments and nested incremental boxes", () => {
    const s = renderSlide(mixed);
    expect(s.querySelector(".nonincremental li")!.classList.contains("fragment")).toBe(false);
    expect(s.querySelector(".columns")!.classList.contains("fragment")).toBe(false);
    expect(domFragments(mixed)).toBe(5);
  });

  it("works on a level-1 divider slide", () => {
    expect(domFragments(divider)).toBe(2);
  });
});

describe("the cursor follow counts the same fragments as the deck", () => {
  for (const [name, md] of Object.entries({ wholeSlide, quartoDiv, looseList, mixed, divider })) {
    it(name, () => {
      expect(sourceFragments(md)).toBe(domFragments(md));
    });
  }

  it("points at the list item the cursor is in", () => {
    expect(fragmentIndexForOffset(wholeSlide, wholeSlide.indexOf("- two") + 2)).toBe(2);
  });

  it("is -1 on the title line", () => {
    expect(fragmentIndexForOffset(wholeSlide, 3)).toBe(-1);
  });
});
