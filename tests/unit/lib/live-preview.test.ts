import { describe, it, expect } from "vitest";
import { hideRanges } from "~/lib/cm-live-preview";

/** The text each hidden range covers, which is easier to read than offsets. */
function hidden(text: string, sel: { from: number; to: number }[] = []): string[] {
  return hideRanges(text, sel).map((r) => text.slice(r.from, r.to));
}

/** A bare cursor at `pos`. */
const at = (pos: number) => [{ from: pos, to: pos }];

describe("live preview hide ranges", () => {
  it("hides a heading's hashes and the space after them", () => {
    const text = "## Heading\n\nBody text.\n";
    expect(hidden(text)).toEqual(["## "]);
  });

  it("reveals the hashes when the cursor is anywhere on that line", () => {
    const text = "## Heading\n\nBody text.\n";
    expect(hidden(text, at(text.indexOf("Heading") + 3))).toEqual([]);
    // ...and hides them again from another line.
    expect(hidden(text, at(text.indexOf("Body")))).toEqual(["## "]);
  });

  it("hides a closing hash run with the space before it", () => {
    expect(hidden("### Heading ###\n")).toEqual(["### ", " ###"]);
  });

  it("hides emphasis, strong, inline code and strikethrough marks", () => {
    const text = "A **bold** and _thin_ and `code` and ~~gone~~ word.\n";
    expect(hidden(text)).toEqual(["**", "**", "_", "_", "`", "`", "~~", "~~"]);
  });

  it("reveals an inline mark only from inside its own span", () => {
    const text = "A **bold** word.\n";
    const inside = text.indexOf("bold") + 2;
    expect(hidden(text, at(inside))).toEqual([]);
    // The word after it is a different span, so the marks stay hidden.
    expect(hidden(text, at(text.indexOf("word")))).toEqual(["**", "**"]);
  });

  it("reveals at the span's own edges, so arrowing in reveals first", () => {
    const text = "A **bold** word.\n";
    const span = { from: text.indexOf("**"), to: text.indexOf("**") + 8 };
    expect(hidden(text, at(span.from))).toEqual([]);
    expect(hidden(text, at(span.to))).toEqual([]);
    expect(hidden(text, at(span.from - 1))).toEqual(["**", "**"]);
  });

  it("hides a link's brackets and URL, leaving the text", () => {
    const text = "See [the plan](https://example.com/x) for detail.\n";
    // The trailing run is ONE range: the caret must not be able to sit at a
    // boundary inside it, which would put typed text into the URL.
    expect(hidden(text)).toEqual(["[", "](https://example.com/x)"]);
    expect(hidden(text, at(text.indexOf("plan")))).toEqual([]);
  });

  it("merges touching hidden marks into one range", () => {
    // Bold immediately inside italic: four marks, two contiguous runs.
    const text = "A _**both**_ word.\n";
    expect(hidden(text)).toEqual(["_**", "**_"]);
  });

  it("replaces an image with the picture, and reveals it on the line", () => {
    const text = "![alt text](img/pic.png)\n";
    const [r] = hideRanges(text);
    expect(text.slice(r.from, r.to)).toBe("![alt text](img/pic.png)");
    expect(r.show).toEqual({ image: { alt: "alt text", src: "img/pic.png" } });
    expect(hideRanges(text, at(3))).toEqual([]);
  });

  it("reads an image src written in angle brackets", () => {
    const [r] = hideRanges("![](<img/a pic.png>)\n");
    expect(r.show).toEqual({ image: { alt: "", src: "img/a pic.png" } });
  });

  it("shows a bullet list's dash as a bullet, and its numbers as they are", () => {
    const text = "- one\n- two\n\n1. first\n2. second\n";
    const marks = hideRanges(text);
    expect(marks.map((r) => text.slice(r.from, r.to))).toEqual(["-", "-"]);
    expect(marks.every((r) => r.show && "bullet" in r.show)).toBe(true);
    // The cursor on a list line brings its dash back.
    expect(hideRanges(text, at(2)).length).toBe(1);
  });

  it("never hides inside a CriticMarkup span", () => {
    const text = "A {++**bold** insert++} here.\n";
    expect(hidden(text)).toEqual([]);
  });

  it("treats a # inside a fenced code block as code, not a heading", () => {
    const text = "Text.\n\n```py\n# not a heading\n```\n\n## Real heading\n";
    expect(hidden(text)).toEqual(["## "]);
  });

  it("leaves a setext heading's underline alone", () => {
    expect(hidden("Heading\n=======\n\nBody.\n")).toEqual([]);
  });

  it("shows an Obsidian image embed as the picture", () => {
    const text = "Before.\n\n![[INTRAC MAP.png]]\n\nAfter.\n";
    const img = hideRanges(text).find((r) => r.show && "image" in r.show);
    expect(text.slice(img!.from, img!.to)).toBe("![[INTRAC MAP.png]]");
    expect(img!.show).toEqual({ image: { alt: "", src: "INTRAC MAP.png" } });
    // An alias becomes the alt text, and a note embed stays a wikilink.
    expect(hideRanges("![[pic.png|A map]]\n")[0].show).toEqual({ image: { alt: "A map", src: "pic.png" } });
    expect(hideRanges("![[Some note]]\n").some((r) => r.show && "image" in r.show)).toBe(false);
  });

  it("fades a Pandoc attribute block rather than hiding it", () => {
    const text = "### Our approach {.rounded}\n";
    const fades = hideRanges(text).filter((r) => r.show && "fade" in r.show);
    expect(fades.map((r) => text.slice(r.from, r.to))).toEqual(["{.rounded}"]);
    // An id and a dimension attribute count too; CriticMarkup never does.
    expect(hideRanges("A [word]{#tag} here.\n").some((r) => r.show && "fade" in r.show)).toBe(true);
    expect(hideRanges("A {++suggested++} word.\n").some((r) => r.show && "fade" in r.show)).toBe(false);
  });

  it("hides a blockquote's markers and styles the line", () => {
    const text = "> A quoted line.\n> A second one.\n";
    const marks = hideRanges(text);
    expect(marks.filter((r) => !r.show).map((r) => text.slice(r.from, r.to))).toEqual(["> ", "> "]);
    expect(marks.filter((r) => r.show && "line" in r.show).length).toBe(2);
  });

  it("colours a callout by its type and drops the [!tip] token", () => {
    const text = "> [!tip] Worth knowing\n> The body of the tip.\n";
    const marks = hideRanges(text);
    const lines = marks.filter((r) => r.show && "line" in r.show);
    expect(lines.length).toBe(2);
    expect((lines[0].show as { line: string }).line).toContain("cm-lp-callout-tip");
    // The `>` and the `[!tip]` token are contiguous, so they hide as one range.
    expect(marks.some((r) => !r.show && text.slice(r.from, r.to) === "> [!tip] ")).toBe(true);
    // An alias resolves to its colour bucket, as the renderer does.
    const hint = hideRanges("> [!hint] X\n").filter((r) => r.show && "line" in r.show);
    expect((hint[0].show as { line: string }).line).toContain("cm-lp-callout-tip");
  });

  it("fades the Garden's --{.tip} markers and colours the block", () => {
    const text = "--{.tip}\nThe quoted line.\n--\n\nAfter.\n";
    const marks = hideRanges(text);
    expect(marks.filter((r) => r.show && "fade" in r.show).map((r) => text.slice(r.from, r.to)))
      .toEqual(["--{.tip}", "--"]);
    const lines = marks.filter((r) => r.show && "line" in r.show);
    expect(lines.length).toBe(1);
    expect((lines[0].show as { line: string }).line).toContain("cm-lp-callout-tip");
  });

  it("hides nothing in a plain paragraph", () => {
    expect(hidden("Just a sentence with no marks at all.\n")).toEqual([]);
  });
});
