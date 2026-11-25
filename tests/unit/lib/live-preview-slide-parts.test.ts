import { describe, it, expect } from "vitest";
import { slideParts } from "~/lib/cm-live-preview";

/**
 * Live view over the slide the cursor is in: the slide is source, and each of
 * its parts (a fenced div, a raw HTML or SVG block) stays drawn until the
 * selection touches that part. `slideParts` is the pure split; these tests
 * need no DOM.
 */

const at = (text: string, needle: string) => {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`no ${needle} in the slide`);
  return [{ from: i, to: i }];
};
const texts = (text: string, needle: string, base = 0) =>
  slideParts(text, at(text, needle).map((r) => ({ from: r.from + base, to: r.to + base })), base).map((p) => p.text);

const card = "::: {.card}\nIn the card.\n:::";
const svg = '<svg viewBox="0 0 10 10">\n<rect width="10" height="10"/>\n</svg>';
const slide = `## Title\n\nIntro words.\n\n${card}\n\n${svg}\n`;

describe("slideParts", () => {
  it("draws every part when the cursor is on the slide's prose", () => {
    expect(texts(slide, "Intro")).toEqual([card, svg]);
  });

  it("shows only the part the cursor is in as source", () => {
    expect(texts(slide, "In the card")).toEqual([svg]);
    expect(texts(slide, "rect")).toEqual([card]);
  });

  it("counts a cursor on a part's own edge as inside it", () => {
    const end = slide.indexOf(card) + card.length;
    expect(slideParts(slide, [{ from: end, to: end }]).map((p) => p.text)).toEqual([svg]);
    const start = slide.indexOf(card);
    expect(slideParts(slide, [{ from: start, to: start }]).map((p) => p.text)).toEqual([svg]);
  });

  it("reveals every part a selection spans", () => {
    const from = slide.indexOf("In the card");
    const to = slide.indexOf("rect");
    expect(slideParts(slide, [{ from, to }])).toEqual([]);
  });

  it("gives positions in the document, offset by base", () => {
    const base = 500;
    const parts = slideParts(slide, [{ from: base, to: base }], base);
    expect(parts.map((p) => p.from - base)).toEqual([slide.indexOf(card), slide.indexOf(svg)]);
    for (const p of parts) expect(slide.slice(p.from - base, p.to - base)).toBe(p.text);
  });

  it("in a two-column slide keeps the other column drawn", () => {
    const colA = "::: {.column}\nLeft words.\n:::";
    const colB = "::: {.column}\n![](right.svg)\n:::";
    const cols = `## Two\n\n:::: {.columns}\n${colA}\n${colB}\n::::\n`;
    expect(texts(cols, "Left words")).toEqual([colB]);
    // Outside the columns block, it is one part.
    expect(texts(cols, "## Two")).toEqual([`:::: {.columns}\n${colA}\n${colB}\n::::`]);
  });

  it("never draws speaker notes, which the render hides", () => {
    const notes = "::: {.notes}\nSay this.\n:::";
    expect(texts(`## T\n\nWords.\n\n${notes}\n`, "Words")).toEqual([]);
  });

  it("does not read a fence inside a code block as a div", () => {
    const code = "```\n::: {.card}\n```";
    expect(texts(`## T\n\nWords.\n\n${code}\n\n${card}\n`, "Words")).toEqual([card]);
    // Nor as the close of a div around it.
    const wrapped = `::: {.panel}\n\n\`\`\`\n:::\n\`\`\`\n\n:::`;
    expect(texts(`## T\n\nWords.\n\n${wrapped}\n`, "Words")).toEqual([wrapped]);
  });

  it("runs an unclosed div to the end of the slide, where the render closes it", () => {
    const open = "::: {.card}\nNo closer yet.";
    expect(texts(`## T\n\nWords.\n\n${open}`, "Words")).toEqual([open]);
  });

  it("ignores a closer with no div open, which the render drops", () => {
    expect(texts(`## T\n\n:::\n\nWords.\n\n${card}\n`, "Words")).toEqual([card]);
  });

  it("keeps an SVG with a blank line inside as one part", () => {
    const tall = '<svg viewBox="0 0 10 10">\n<rect/>\n\n<circle r="2"/>\n</svg>';
    expect(texts(`## T\n\nWords.\n\n${tall}\n`, "Words")).toEqual([tall]);
  });

  it("reads an SVG's open tag split over lines", () => {
    const split = '<svg viewBox="0 0 10 10"\n     width="200">\n\n<rect/>\n</svg>';
    expect(texts(`## T\n\nWords.\n\n${split}\n`, "Words")).toEqual([split]);
  });

  it("takes a caption line straight after the close tag, as the renderer does", () => {
    const withCaption = `${svg}\nA caption line.`;
    expect(texts(`## T\n\nWords.\n\n${withCaption}\n\nMore.\n`, "Words")).toEqual([withCaption]);
  });

  it("ends an HTML block at the next fence, which the render turns into a blank line", () => {
    const panel = `::: {.panel}\n${svg}\n:::`;
    // Inside the panel, the SVG is its own part.
    expect(texts(`## T\n\n${panel}\n\nAfter.\n`, "## T")).toEqual([panel]);
    expect(texts(`## T\n\n::: {.panel}\nPanel words.\n${svg}\n:::\n`, "Panel words")).toEqual([]);
    expect(texts(`## T\n\n::: {.panel}\nPanel words.\n\n${svg}\n:::\n`, "Panel words")).toEqual([svg]);
    expect(texts(`## T\n\n::: {.panel}\n${svg}\n:::\n\nAfter.\n`, "After")).toEqual([`::: {.panel}\n${svg}\n:::`]);
  });

  it("does not start an HTML block inside a paragraph, or at a phrasing tag", () => {
    expect(texts(`## T\n\nWords.\n${svg}\n`, "## T")).toEqual([]);
    expect(texts(`## T\n\n<span class="x">Words</span> here.\n`, "## T")).toEqual([]);
  });

  it("starts an HTML block straight after a heading", () => {
    expect(texts(`## T\n${svg}\n\nWords.\n`, "Words")).toEqual([svg]);
  });

  it("leaves style blocks as source", () => {
    expect(texts(`## T\n\nWords.\n\n<style>\n.x { color: red }\n</style>\n`, "Words")).toEqual([]);
  });

  it("draws a lone raw image tag", () => {
    const img = '<img src="pic.svg" alt="a picture">';
    expect(texts(`## T\n\nWords.\n\n${img}\n`, "Words")).toEqual([img]);
  });
});
