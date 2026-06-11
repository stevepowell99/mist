// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { createElement } from "react";
import CitationPopup from "~/components/CitationPopup";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { Extension } from "@tiptap/core";
import {
  CitationSuggest,
  createCitationController,
  type CitationSuggestState,
} from "~/lib/citation-suggest";
import { suggestModePlugin } from "~/lib/suggest-mode";
import { parseBib } from "~/lib/citations";

const SuggestModeExt = Extension.create({
  name: "suggestModeTest",
  addProseMirrorPlugins() {
    return [suggestModePlugin({ get: () => "suggest" })];
  },
});

/** Simulate real keyboard typing so suggest-mode's handleTextInput intercepts. */
function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

const BIB = `@article{smith2020,
  author = {Smith, Jane and Jones, Bob},
  year = {2020},
  title = {A study of things},
}`;

describe("citation @-picker trigger", () => {
  let editor: Editor;
  let emissions: (CitationSuggestState | null)[];

  beforeEach(() => {
    const controller = createCitationController();
    controller.setLibrary(parseBib(BIB));
    controller.setModeGetter(() => "edit");
    emissions = [];
    controller.subscribe((s) => emissions.push(s));

    const el = document.createElement("div");
    document.body.appendChild(el);
    editor = new Editor({
      element: el,
      extensions: [
        Document,
        Paragraph,
        Text,
        CriticAddition,
        CriticDeletion,
        CriticComment,
        CriticHighlight,
        CitationSuggest.configure({ controller }),
      ],
      content: "<p></p>",
    });
  });

  afterEach(() => {
    editor.destroy();
    cleanup();
  });

  it("emits suggestion state with items when @ is typed at start of paragraph", async () => {
    editor.commands.focus();
    editor.commands.insertContent("@smi");
    await new Promise((r) => setTimeout(r, 0));
    const active = emissions.filter((e) => e !== null) as CitationSuggestState[];
    expect(active.length).toBeGreaterThan(0);
    const last = active[active.length - 1];
    expect(last.items.map((i) => i.key)).toContain("smith2020");
  });

  it("triggers with Collaboration (Yjs) in the extension stack", async () => {
    const { default: Collaboration } = await import("@tiptap/extension-collaboration");
    const Y = await import("yjs");
    editor.destroy();
    const controller = createCitationController();
    controller.setLibrary(parseBib(BIB));
    controller.setModeGetter(() => "suggest");
    emissions = [];
    controller.subscribe((s) => emissions.push(s));
    const ydoc = new Y.Doc();
    const el = document.createElement("div");
    document.body.appendChild(el);
    editor = new Editor({
      element: el,
      extensions: [
        Document,
        Paragraph,
        Text,
        CriticAddition,
        CriticDeletion,
        CriticComment,
        CriticHighlight,
        Collaboration.configure({ document: ydoc }),
        SuggestModeExt,
        CitationSuggest.configure({ controller }),
      ],
    });
    editor.commands.focus();
    typeText(editor, "@smi");
    await new Promise((r) => setTimeout(r, 0));
    const active = emissions.filter((e) => e !== null) as CitationSuggestState[];
    expect(active.length).toBeGreaterThan(0);
    expect(active[active.length - 1].items.map((i) => i.key)).toContain("smith2020");
  });

  it("triggers in suggest mode (typed through handleTextInput)", async () => {
    // Rebuild the editor with suggest-mode active, like a default doc.
    editor.destroy();
    const controller = createCitationController();
    controller.setLibrary(parseBib(BIB));
    controller.setModeGetter(() => "suggest");
    emissions = [];
    controller.subscribe((s) => emissions.push(s));
    const el = document.createElement("div");
    document.body.appendChild(el);
    editor = new Editor({
      element: el,
      extensions: [
        Document,
        Paragraph,
        Text,
        CriticAddition,
        CriticDeletion,
        CriticComment,
        CriticHighlight,
        SuggestModeExt,
        CitationSuggest.configure({ controller }),
      ],
      content: "<p></p>",
    });
    editor.commands.focus();
    typeText(editor, "@smi");
    await new Promise((r) => setTimeout(r, 0));
    const active = emissions.filter((e) => e !== null) as CitationSuggestState[];
    expect(active.length).toBeGreaterThan(0);
    expect(active[active.length - 1].items.map((i) => i.key)).toContain("smith2020");
  });

  it("renders the popup list when the controller emits state", () => {
    const controller = createCitationController();
    render(createElement(CitationPopup, { controller }));
    const lib = parseBib(BIB);
    act(() => {
      controller.emit({
        items: [...lib.entries()].map(([key, entry]) => ({ key, entry })),
        command: () => {},
        clientRect: () => new DOMRect(10, 10, 0, 16),
      });
    });
    expect(screen.getByText(/Smith & Jones \(2020\)/)).toBeTruthy();
    expect(screen.getByText("A study of things")).toBeTruthy();
  });
});
