import { describe, it, expect } from "vitest";
import { slideIndexForOffset, fragmentIndexForOffset } from "~/lib/slide-cursor";

const md = [
  "---",
  "title: x",
  "format: revealjs",
  "---",
  "",
  "# Title",
  "",
  "intro text",
  "",
  "## Second slide",
  "",
  "content here",
  "",
  "## Third slide",
  "",
  "more",
].join("\n");

const at = (needle: string) => slideIndexForOffset(md, md.indexOf(needle));

describe("slideIndexForOffset", () => {
  it("maps the cursor to its slide, ignoring the frontmatter offset", () => {
    expect(at("intro text")).toBe(0);
    expect(at("Second slide")).toBe(1);
    expect(at("content here")).toBe(1);
    expect(at("Third slide")).toBe(2);
    expect(at("more")).toBe(2);
  });

  it("treats a cursor inside the frontmatter as the first slide", () => {
    expect(slideIndexForOffset(md, md.indexOf("title: x"))).toBe(0);
  });

  it("starts a new slide after a --- rule", () => {
    const r = "# A\n\nfirst\n\n---\n\nsecond\n";
    expect(slideIndexForOffset(r, r.indexOf("first"))).toBe(0);
    expect(slideIndexForOffset(r, r.indexOf("second"))).toBe(1);
  });
});

const frag = [
  "---",
  "format: revealjs",
  "---",
  "",
  "# Slide",
  "",
  "intro before any fragment",
  "",
  "::: {.fragment}",
  "first reveal",
  ":::",
  "",
  "::: {.fragment}",
  "second reveal",
  ":::",
  "",
  "## Next slide",
  "",
  "::: {.fragment}",
  "next first",
  ":::",
].join("\n");

describe("fragmentIndexForOffset", () => {
  const at = (needle: string) => fragmentIndexForOffset(frag, frag.indexOf(needle));

  it("is -1 before any fragment on the slide", () => {
    expect(at("intro before")).toBe(-1);
  });

  it("counts fragments cumulatively within the slide", () => {
    expect(at("first reveal")).toBe(0);
    expect(at("second reveal")).toBe(1);
  });

  it("resets the count per slide", () => {
    expect(at("next first")).toBe(0);
  });

  it("ignores a fragment inside a CriticMarkup deletion", () => {
    const d = "# S\n\n{--::: {.fragment}\ngone\n:::--}\n\nhere";
    expect(fragmentIndexForOffset(d, d.indexOf("here"))).toBe(-1);
  });
});
