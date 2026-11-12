import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import { selectionToolbar } from "~/lib/cm-selection-toolbar";

const doc = "Plain words {--gone--} more {>>a note<<} end";
const inSuggestion = doc.indexOf("gone") + 1;
const inComment = doc.indexOf("note") + 1;
const inProse = 3;

/** How many toolbars show after moving the cursor to `pos`, by click or not. */
function barsAfter(pos: number, userEvent: string, opts?: { threads?: boolean }, canEdit = true): number {
  const start = EditorState.create({ doc, extensions: selectionToolbar(() => canEdit, opts) });
  const state = start.update({ selection: { anchor: pos }, userEvent }).state;
  return state.facet(showTooltip).filter(Boolean).length;
}

describe("selection toolbar on a bare cursor", () => {
  it("shows when a click lands on a suggestion or a comment", () => {
    expect(barsAfter(inSuggestion, "select.pointer")).toBe(1);
    expect(barsAfter(inComment, "select.pointer")).toBe(1);
    expect(barsAfter(inComment, "select.pointer", { threads: false })).toBe(1);
  });

  it("does not show on a click in plain prose", () => {
    expect(barsAfter(inProse, "select.pointer")).toBe(0);
  });

  it("does not show when the keyboard moves the cursor in", () => {
    expect(barsAfter(inSuggestion, "select")).toBe(0);
    expect(barsAfter(inComment, "select")).toBe(0);
  });

  it("offers nothing a read-only user could use on a text-only comment or a suggestion", () => {
    expect(barsAfter(inComment, "select.pointer", { threads: false }, false)).toBe(0);
    expect(barsAfter(inSuggestion, "select.pointer", undefined, false)).toBe(0);
    // A thread can still be replied to.
    expect(barsAfter(inComment, "select.pointer", undefined, false)).toBe(1);
  });
});
