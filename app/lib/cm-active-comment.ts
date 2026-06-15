import { StateField, StateEffect, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * The active-comment highlight for the CodeMirror 6 / Y.Text core. Clicking a
 * thread in the panel (or moving the cursor into a comment) tints its range
 * with `cm-comment-active`, reusing the existing CSS. The decoration is mapped
 * through document changes so it follows concurrent edits until cleared.
 */
export const setActiveComment = StateEffect.define<{ from: number; to: number } | null>();

export const activeCommentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setActiveComment)) {
        if (e.value && e.value.to > e.value.from) {
          const range: Range<Decoration> = Decoration.mark({ class: "cm-comment-active" }).range(
            e.value.from,
            e.value.to,
          );
          deco = Decoration.set([range]);
        } else {
          deco = Decoration.none;
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
