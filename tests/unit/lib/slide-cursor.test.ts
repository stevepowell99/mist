import { describe, it, expect } from "vitest";
import { slideIndexForOffset } from "~/lib/slide-cursor";

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
