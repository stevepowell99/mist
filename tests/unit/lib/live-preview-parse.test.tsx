// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { livePreview } from "~/lib/cm-live-preview";

/**
 * Live preview against the markdown parser's own laziness.
 *
 * The parser does not read the document when the state is made. It reads the
 * first three thousand characters and leaves the rest to a background worker,
 * which catches up over idle callbacks and announces each chunk in a
 * transaction that changes neither the document, nor the selection, nor the
 * viewport. Anything that rebuilds decorations only on those three therefore
 * stops at whatever the tree happened to cover, which showed as raw `##` and
 * `**` down most of a real document until a keystroke happened to rebuild it.
 */

/** Count the block widgets (a rendered table or diagram) the state carries. */
function blockWidgets(view: EditorView): number {
  let n = 0;
  for (const src of view.state.facet(EditorView.decorations)) {
    if (typeof src === "function") continue; // the view plugins' own sets
    const it = src.iter();
    while (it.value) {
      if ((it.value.spec as { widget?: unknown }).widget) n++;
      it.next();
    }
  }
  return n;
}

const padding = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `Padding line ${i} with some words in it.\n\n`).join("");

describe("live preview and the lazy parse", () => {
  it("a long document is only partly parsed when its state is made", () => {
    const doc = padding(300);
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(doc.length).toBeGreaterThan(4000);
    expect(syntaxTree(state).length).toBeLessThan(doc.length);
  });

  it("renders a table that the first parse did not reach", async () => {
    const doc = `${padding(100)}\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nEnd.\n`;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage }), livePreview()],
      }),
      parent: document.body,
    });
    try {
      // The table sits past the first parse, so nothing is rendered for it yet.
      expect(syntaxTree(view.state).length).toBeLessThan(doc.length);
      expect(blockWidgets(view)).toBe(0);

      // The background parse finishes and says so in a transaction that changes
      // nothing else. That has to be enough to rebuild.
      await new Promise((r) => setTimeout(r, 800));
      expect(syntaxTree(view.state).length).toBe(doc.length);
      expect(blockWidgets(view)).toBe(1);
    } finally {
      view.destroy();
    }
  });
});

describe("live preview over a deck", () => {
  const deck = (
    "---\nformat: revealjs\n---\n\n# Slide one\n\nfirst\n\n## Slide two\n\nsecond\n"
  );

  it("renders each slide as a card, hiding its raw markdown", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: deck,
        selection: { anchor: 0 },
        extensions: [markdown({ base: markdownLanguage }), livePreview()],
      }),
      parent: document.body,
    });
    try {
      expect(view.dom.querySelectorAll(".cm-lp-slide")).toHaveLength(2);
      expect(view.dom.textContent).not.toContain("# Slide one");
      expect(view.dom.textContent).not.toContain("## Slide two");
    } finally {
      view.destroy();
    }
  });

  it("drops back to raw markdown for the slide the cursor is in", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: deck,
        selection: { anchor: deck.indexOf("first") },
        extensions: [markdown({ base: markdownLanguage }), livePreview()],
      }),
      parent: document.body,
    });
    try {
      // The slide under the cursor is source, so its heading mark is present in
      // the DOM (hidden by the mark-level decoration, not the block widget).
      expect(view.dom.querySelectorAll(".cm-lp-slide")).toHaveLength(1);
      expect(view.dom.textContent).not.toContain("## Slide two");
    } finally {
      view.destroy();
    }
  });

  it("a click inside a fenced-div panel lands on the paragraph it hit, not the slide start", () => {
    const panelDeck =
      "---\nformat: revealjs\n---\n\n# Slide one\n\n::: {.panel .navy .light}\n\n" +
      "First para.\n\nSecond para.\n\n:::\n";
    const view = new EditorView({
      state: EditorState.create({
        doc: panelDeck,
        selection: { anchor: 0 },
        extensions: [markdown({ base: markdownLanguage }), livePreview()],
      }),
      parent: document.body,
    });
    // jsdom does no layout, so every real rect is zero; fake one block per
    // anchor stepping down the page, the one thing `slideClickPos` relies on
    // (later blocks sit lower than earlier ones), so a click's y can be made
    // to land on a specific block the way a real click would.
    const blockTop = new Map<Element, number>();
    let y = 0;
    for (const a of view.dom.querySelectorAll("br[data-pos]")) {
      if (a.nextElementSibling) blockTop.set(a.nextElementSibling, y);
      y += 20;
    }
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = blockTop.get(this) ?? 0;
      return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON() {} } as DOMRect;
    };
    try {
      const target = Array.from(view.dom.querySelectorAll("p")).find(
        (p) => p.textContent === "Second para.",
      )!;
      expect(target).toBeTruthy();
      // A click at the paragraph's own y, but landing on its parent (the
      // panel div) rather than the paragraph itself: exactly what a click on
      // the blank padding around real rendered text does, and the case that
      // broke when this matched the click's DOM target instead of its y.
      const clientY = target.getBoundingClientRect().top;
      target.parentElement!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientY }),
      );
      const head = view.state.selection.main.head;
      const secondParaAt = panelDeck.indexOf("Second para.");
      const closer = panelDeck.indexOf(":::", secondParaAt);
      // Landed in (or right at the start of) the second paragraph, not back at
      // the slide's own heading, which `posAtDOM` on the widget root alone
      // would have given.
      expect(head).toBeGreaterThanOrEqual(secondParaAt);
      expect(head).toBeLessThan(closer);
    } finally {
      Element.prototype.getBoundingClientRect = original;
      view.destroy();
    }
  });
});

describe("live preview over a document with an image", () => {
  it("keeps hiding marks rather than throwing the plugin away", async () => {
    const doc = "# Title\n\nSome **bold** text.\n\n![a picture](img/x.png)\n\nMore text.\n";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        // Away from the heading, whose marks are revealed by a cursor on its line.
        selection: { anchor: doc.indexOf("More text") },
        extensions: [
          markdown({ base: markdownLanguage }),
          livePreview({ resolveSrc: (s) => `/proxy/${s}` }),
        ],
      }),
      parent: document.body,
    });
    try {
      // The plugin survived, so the heading's hashes are still hidden. A plugin
      // that threw is silently dropped by CodeMirror and every mark comes back.
      expect(view.dom.textContent).not.toContain("# Title");
      // The image markup was replaced too: either by the picture, or, where the
      // src will not load, by the widget's own missing-image note.
      expect(view.dom.textContent).not.toContain("![a picture]");
    } finally {
      view.destroy();
    }
  });
});
