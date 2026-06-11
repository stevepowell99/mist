// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { markdownDecorations } from "~/lib/markdown-decorations";

const MD = Extension.create({
  name: "md",
  addProseMirrorPlugins() {
    return markdownDecorations(null);
  },
});

function build(content: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: [Document, Paragraph, Text, MD], content });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let editor: Editor;
afterEach(() => editor?.destroy());

describe("markdown decorations: incremental recompute", () => {
  it("highlights initial content immediately (synchronous init)", () => {
    editor = build("<p>some **bold** here</p>");
    expect(editor.view.dom.querySelector(".md-bold")).toBeTruthy();
  });

  it("typing new markdown gets highlighted after the debounce", async () => {
    editor = build("<p>plain text</p>");
    expect(editor.view.dom.querySelector(".md-bold")).toBeNull();
    // Type **x** at the end of the paragraph (plain dispatch avoids jsdom's
    // missing coordsAtPos via scrollIntoView).
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText("**x**", end));
    await sleep(200);
    expect(editor.view.dom.querySelector(".md-bold")).toBeTruthy();
  });

  it("stays fast on a long document (maps per keystroke, not full recompute)", () => {
    const content = Array.from(
      { length: 1500 },
      (_, i) => `<p>Para ${i} with **bold** and [a link](http://x) and _italic_ text</p>`,
    ).join("");
    editor = build(content);
    const at = 3;
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      editor.view.dispatch(editor.state.tr.insertText("x", at + i));
    }
    const perKey = (performance.now() - t0) / 500;
    // Old behaviour recomputed the whole doc each key (~100ms/key at this size).
    // Mapping should keep it well under a millisecond; allow generous headroom.
    expect(perKey).toBeLessThan(10);
  });
});
