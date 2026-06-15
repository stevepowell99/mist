import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

/**
 * Editor conveniences for the markdown source view (Obsidian / slides-app
 * style). mist stores plain markdown text, so "bold" means wrapping the
 * selection in literal `**` markers, not a WYSIWYG mark. Suggest mode, when
 * active, turns the inserted markers into suggestions like any other edit.
 *
 * - Mod-B / Mod-I wrap the selection (or drop empty markers) in `**` / `*`.
 * - Typing a wrapping character over a selection wraps it instead of replacing:
 *   `*` `_` `` ` `` (emphasis/code), `=` -> `==highlight==`, and the bracket and
 *   quote pairs.
 */
const WRAP_PAIRS: Record<string, [string, string]> = {
  "*": ["*", "*"],
  _: ["_", "_"],
  "`": ["`", "`"],
  "=": ["==", "=="],
  '"': ['"', '"'],
  "'": ["'", "'"],
  "(": ["(", ")"],
  "[": ["[", "]"],
  "{": ["{", "}"],
};

/** Wrap the selection (or place a cursor between empty markers) with open/close. */
function wrapSelection(editor: TiptapEditor, open: string, close: string): boolean {
  const { state, view } = editor;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) {
    tr.insertText(open + close, from);
    tr.setSelection(TextSelection.create(tr.doc, from + open.length));
  } else {
    // Insert the closing marker first so the opening insert does not shift `to`.
    tr.insertText(close, to);
    tr.insertText(open, from);
    tr.setSelection(TextSelection.create(tr.doc, from + open.length, to + open.length));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const MarkdownShortcuts = Extension.create({
  name: "markdownShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-b": () => wrapSelection(this.editor, "**", "**"),
      "Mod-i": () => wrapSelection(this.editor, "*", "*"),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (from === to) return false; // no selection: type normally
            const pair = WRAP_PAIRS[text];
            if (!pair) return false;
            const [open, close] = pair;
            const tr = view.state.tr;
            tr.insertText(close, to);
            tr.insertText(open, from);
            tr.setSelection(TextSelection.create(tr.doc, from + open.length, to + open.length));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
