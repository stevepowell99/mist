import { describe, it, expect } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { selectNextOccurrence } from "@codemirror/search";
import { selectionHelpers } from "~/lib/cm-selection";

/** Run Ctrl/Cmd+D's command `times` times and return the selected texts. */
function pressModD(extensions: unknown[], times: number): string[] {
  const doc = "Hello world and the world.\n\nAnother world here.\n";
  let state = EditorState.create({ doc, selection: { anchor: 8 }, extensions: extensions as never });
  const dispatch = (tr: Transaction) => {
    state = tr.state;
  };
  for (let i = 0; i < times; i++) selectNextOccurrence({ state, dispatch });
  return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to));
}

describe("selectionHelpers", () => {
  it("lets Ctrl/Cmd+D add each next occurrence as another selection", () => {
    expect(pressModD(selectionHelpers, 3)).toEqual(["world", "world", "world"]);
  });

  it("is what makes that work: without it only the first match is ever selected", () => {
    expect(pressModD([], 3)).toEqual(["world"]);
  });
});
