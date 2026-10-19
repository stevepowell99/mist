// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview } from "~/lib/cm-live-preview";

/**
 * A picture that fails to load shows a fallback on screen and leaves the
 * document alone. The fallback used to replace the widget's root node, which
 * CodeMirror read back as typed text, so `[image not found: ...]` was saved
 * into the file in place of the image markup.
 */
describe("live preview image fallback", () => {
  it("a broken image changes the screen, not the document", async () => {
    const doc = "Intro.\n\n![a chart](img/missing.svg)\n\nEnd.\n";
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 }, // off the image line, so the widget renders
        extensions: [markdown({ base: markdownLanguage }), livePreview({ resolveSrc: (s) => s })],
      }),
      parent,
    });
    const img = parent.querySelector("img.cm-lp-img");
    expect(img).not.toBeNull();
    img!.dispatchEvent(new Event("error"));
    // Let the mutation observer deliver, then make the view read it.
    await new Promise((r) => setTimeout(r, 0));
    (view as unknown as { observer: { flush(): void } }).observer.flush();

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector(".cm-lp-img-missing")?.textContent).toContain("img/missing.svg");
    view.destroy();
    parent.remove();
  });
});
