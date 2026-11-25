import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { drawingFolds, mistFolds } from "~/lib/cm-folding";

/**
 * Drawing code (inline SVG, style and script blocks, diagram fences) starts
 * folded, and the gutter can fold a whole SVG back up. Both rest on the pure
 * `drawingFolds` and the fold service; neither needs a DOM.
 */

const svg = '<svg viewBox="0 0 10 10">\n<rect width="10" height="10"/>\n</svg>';
const mermaid = "```mermaid\ngraph LR\nA --> B\n```";

/** The text each fold hides, from the end of its first line to its last line's end. */
const hidden = (text: string) => {
  const doc = EditorState.create({ doc: text }).doc;
  return drawingFolds(doc).map((r) => text.slice(r.from, r.to));
};
/** The first line of each folded block. */
const heads = (text: string) => {
  const doc = EditorState.create({ doc: text }).doc;
  return drawingFolds(doc).map((r) => doc.lineAt(r.from).text);
};

describe("drawingFolds", () => {
  it("folds an inline SVG from the end of its first line to its close tag", () => {
    const text = `# Title\n\nWords.\n\n${svg}\n\nMore.\n`;
    expect(hidden(text)).toEqual(["\n<rect width=\"10\" height=\"10\"/>\n</svg>"]);
  });

  it("folds a mermaid fence, by its language or by what it holds", () => {
    expect(heads(`Words.\n\n${mermaid}\n`)).toEqual(["```mermaid"]);
    expect(heads("Words.\n\n```{mermaid}\ngraph LR\nA --> B\n```\n")).toEqual(["```{mermaid}"]);
    expect(heads("Words.\n\n```\nflowchart TD\nA --> B\n```\n")).toEqual(["```"]);
  });

  it("folds a DOT fence, and style and script blocks", () => {
    const text = "```dot\ndigraph { a -> b }\n```\n\n<style>\n.x { color: red }\n</style>\n\n<script>\nlet a = 1;\n</script>\n";
    expect(heads(text)).toEqual(["```dot", "<style>", "<script>"]);
  });

  it("leaves an ordinary code fence open, since it is there to be read", () => {
    expect(hidden("```python\nprint(1)\nprint(2)\n```\n")).toEqual([]);
  });

  it("does not fold an SVG shown as code inside a fence", () => {
    expect(hidden(`\`\`\`html\n${svg}\n\`\`\`\n`)).toEqual([]);
  });

  it("keeps an SVG with blank lines in it as one fold", () => {
    const tall = '<svg viewBox="0 0 10 10">\n<rect/>\n\n<circle r="2"/>\n</svg>';
    expect(hidden(`Words.\n\n${tall}\n`)).toEqual(["\n<rect/>\n\n<circle r=\"2\"/>\n</svg>"]);
  });

  it("folds an SVG straight after a fenced div's opener", () => {
    expect(heads(`::: {.column}\n${svg}\n:::\n`)).toEqual(['<svg viewBox="0 0 10 10">']);
  });

  it("folds once for an SVG with a style element inside it", () => {
    const styled = '<svg viewBox="0 0 10 10">\n<style>\n.a { fill: red }\n</style>\n<rect/>\n</svg>';
    expect(heads(`${styled}\n`)).toEqual(['<svg viewBox="0 0 10 10">']);
  });

  it("does not fold a one-line SVG, a self-closed one, or one never closed", () => {
    expect(hidden('<svg viewBox="0 0 1 1"><rect/></svg>\n')).toEqual([]);
    expect(hidden('<svg viewBox="0 0 1 1"\n  />\n')).toEqual([]);
    expect(hidden('<svg viewBox="0 0 1 1">\n<rect/>\n')).toEqual([]);
  });

  it("does not fold a diagram fence that is still being written", () => {
    expect(hidden("```mermaid\ngraph LR\nA --> B\n")).toEqual([]);
  });

  it("finds every block in order", () => {
    expect(heads(`${svg}\n\nWords.\n\n${mermaid}\n\n${svg}\n`)).toEqual([
      '<svg viewBox="0 0 10 10">',
      "```mermaid",
      '<svg viewBox="0 0 10 10">',
    ]);
  });
});

describe("the fold gutter", () => {
  const state = (text: string) =>
    EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage }), mistFolds] });

  it("folds a whole SVG, even where the parser ends the block at a blank line", () => {
    const tall = '<svg viewBox="0 0 10 10">\n<rect/>\n\n<circle r="2"/>\n</svg>';
    const text = `Words.\n\n${tall}\n`;
    const s = state(text);
    const line = s.doc.line(3);
    const range = foldable(s, line.from, line.to);
    expect(range && text.slice(range.from, range.to)).toBe("\n<rect/>\n\n<circle r=\"2\"/>\n</svg>");
  });

  it("still folds fenced divs and the frontmatter", () => {
    const text = "---\ntitle: x\n---\n\n::: {.card}\nIn it.\n:::\n";
    const s = state(text);
    const first = s.doc.line(1);
    expect(foldable(s, first.from, first.to)).toEqual({ from: first.to, to: s.doc.line(3).to });
    const div = s.doc.line(5);
    expect(foldable(s, div.from, div.to)).toEqual({ from: div.to, to: s.doc.line(7).to });
  });
});
