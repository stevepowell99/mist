// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeFolding, foldedRanges, unfoldAll } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { mistFolds } from "~/lib/cm-folding";
import { livePreview } from "~/lib/cm-live-preview";

/**
 * Drawing code starts folded when the editor opens on text or the whole text
 * is replaced (a room's first sync, a reload from disk), never under the
 * cursor, and is not folded again by ordinary typing.
 */

const svg = '<svg viewBox="0 0 10 10">\n<rect width="10" height="10"/>\n</svg>';
const mermaid = "```mermaid\ngraph LR\nA --> B\n```";
const python = "```python\nprint(1)\nprint(2)\n```";
const doc = `# Title\n\nWords.\n\n${svg}\n\n${mermaid}\n\n${python}\n`;

/** Folds dispatch after the update that asked for them. */
const settle = () => new Promise<void>((r) => queueMicrotask(r));

const mount = (text: string, anchor = 0, extra: unknown[] = []) =>
  new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor },
      extensions: [markdown({ base: markdownLanguage }), codeFolding(), mistFolds, ...(extra as [])],
    }),
    parent: document.body,
  });

/** The first line of each folded block. */
const folded = (view: EditorView) => {
  const out: string[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
    out.push(view.state.doc.lineAt(from).text);
  });
  return out;
};

describe("drawing code folded on load", () => {
  it("folds the SVG and the diagram when the editor opens, and leaves code to read open", async () => {
    const view = mount(doc);
    try {
      await settle();
      expect(folded(view)).toEqual(['<svg viewBox="0 0 10 10">', "```mermaid"]);
      expect(view.dom.querySelectorAll(".cm-foldPlaceholder")).toHaveLength(2);
    } finally {
      view.destroy();
    }
  });

  it("leaves the block the cursor is in open", async () => {
    const view = mount(doc, doc.indexOf("<rect"));
    try {
      await settle();
      expect(folded(view)).toEqual(["```mermaid"]);
    } finally {
      view.destroy();
    }
  });

  it("folds text that arrives in an empty editor, as a room's first sync does", async () => {
    const view = mount("");
    try {
      await settle();
      expect(folded(view)).toEqual([]);
      view.dispatch({ changes: { from: 0, insert: doc } });
      await settle();
      expect(folded(view)).toEqual(['<svg viewBox="0 0 10 10">', "```mermaid"]);
    } finally {
      view.destroy();
    }
  });

  it("folds again when the whole text is replaced, as a reload from disk does", async () => {
    const view = mount(doc);
    try {
      await settle();
      unfoldAll(view);
      expect(folded(view)).toEqual([]);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc.replace("Words", "New words") } });
      await settle();
      expect(folded(view)).toEqual(['<svg viewBox="0 0 10 10">', "```mermaid"]);
    } finally {
      view.destroy();
    }
  });

  it("does not fold a block again once opened, while the text is being edited", async () => {
    const view = mount(doc);
    try {
      await settle();
      unfoldAll(view);
      view.dispatch({ changes: { from: doc.indexOf("Words"), insert: "Typed. " }, userEvent: "input.type" });
      await settle();
      expect(folded(view)).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it("does nothing after the editor is gone", async () => {
    const view = mount(doc);
    view.destroy();
    await settle();
    expect(foldedRanges(view.state).size).toBe(0);
  });

  it("sits beside live preview's drawn slide parts without breaking them", async () => {
    const deck = `---\nformat: revealjs\n---\n\n# Slide one\n\nIntro words.\n\n${svg}\n\n## Slide two\n\nsecond\n`;
    const view = mount(deck, deck.indexOf("Intro"), [livePreview()]);
    try {
      await settle();
      // Folded underneath, and still drawn as a part while the cursor is on the prose.
      expect(folded(view)).toEqual(['<svg viewBox="0 0 10 10">']);
      expect(view.dom.querySelector(".cm-lp-part svg")).toBeTruthy();
      // Onto the SVG's first line: its source shows, still folded.
      view.dispatch({ selection: { anchor: deck.indexOf("<svg") } });
      expect(view.dom.querySelector(".cm-lp-part")).toBeNull();
      expect(view.dom.querySelectorAll(".cm-foldPlaceholder")).toHaveLength(1);
      expect(view.dom.textContent).not.toContain("<rect");
    } finally {
      view.destroy();
    }
  });
});
