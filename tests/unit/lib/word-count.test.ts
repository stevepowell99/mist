import { describe, it, expect } from "vitest";
import { countText } from "~/lib/word-count";

describe("countText", () => {
  it("counts plain prose, with spaces but not line breaks in the characters", () => {
    expect(countText("One two three.\n\nFour five.")).toEqual({ words: 5, chars: 24 });
  });

  it("is zero for an empty or blank text", () => {
    expect(countText("")).toEqual({ words: 0, chars: 0 });
    expect(countText("  \n\n ")).toEqual({ words: 0, chars: 0 });
  });

  it("leaves out the frontmatter", () => {
    expect(countText("---\ntitle: A long title here\n---\nJust this.")).toEqual({ words: 2, chars: 10 });
  });

  it("leaves out markdown marks", () => {
    expect(countText("# A heading\n\n- **bold** and `code`\n> quoted\n\n---")).toEqual({
      words: 6,
      chars: 28,
    });
  });

  it("keeps link text and drops targets, images and attributes", () => {
    expect(countText("See [the site](https://example.com/a/b) ![pic](x.png){.scale-50}").words).toBe(3);
    expect(countText("A [[Note|shown name]] here").words).toBe(4);
  });

  it("takes suggestions as accepted and drops comments", () => {
    expect(countText("keep {--gone--}{++new++} {~~old~>fresh~~} {>>a note<<}").words).toBe(3);
  });

  it("drops fenced-div fences and HTML comments", () => {
    expect(countText("::: {.columns}\nInside\n:::\n<!-- hidden words -->").words).toBe(1);
  });

  it("splits table cells", () => {
    expect(countText("| a | b |\n|---|---|\n|one|two|").words).toBe(4);
  });
});
