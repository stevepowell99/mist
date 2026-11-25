import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { planHelperEdits, type HelperOp } from "~/lib/helper-edits";
import { helperEditSpec, helperMarkAt, helperMarks, helperUndoSpec } from "~/lib/cm-helper-marks";

function start(doc: string) {
  return EditorState.create({ doc, extensions: [history(), helperMarks] });
}

function edit(state: EditorState, turn: string, ops: HelperOp[]) {
  const { changes } = planHelperEdits(state.doc.toString(), ops, "edit");
  return state.update(helperEditSpec(state, turn, changes)).state;
}

describe("helper marks", () => {
  it("marks each change where it now sits", () => {
    const s = edit(start("one two three"), "t1", [{ op: "replace", find: "two", replace: "TWO" }]);
    expect(s.doc.toString()).toBe("one TWO three");
    const m = helperMarkAt(s, "t1", 0)!;
    expect(s.sliceDoc(m.from, m.to)).toBe("TWO");
  });

  it("follows the text as the user types elsewhere, and undoes the turn", () => {
    let s = edit(start("one two three"), "t1", [{ op: "replace", find: "two", replace: "TWO" }]);
    s = s.update({ changes: { from: 0, insert: "Start: " }, userEvent: "input.type" }).state;
    const spec = helperUndoSpec(s, "t1");
    expect(spec).not.toBeNull();
    s = s.update(spec!).state;
    expect(s.doc.toString()).toBe("Start: one two three");
  });

  it("keeps typing against the edge of a change outside its mark", () => {
    let s = edit(start("a b c"), "t1", [{ op: "replace", find: "b", replace: "B" }]);
    const m = helperMarkAt(s, "t1", 0)!;
    s = s.update({ changes: { from: m.to, insert: "!" }, userEvent: "input.type" }).state;
    expect(s.doc.toString()).toBe("a B! c");
    s = s.update(helperUndoSpec(s, "t1")!).state;
    expect(s.doc.toString()).toBe("a b! c");
  });

  it("refuses to undo once the changed text has been edited", () => {
    let s = edit(start("one two three"), "t1", [{ op: "replace", find: "two", replace: "TWO" }]);
    const m = helperMarkAt(s, "t1", 0)!;
    s = s.update({ changes: { from: m.from + 1, to: m.from + 2, insert: "x" }, userEvent: "input.type" }).state;
    expect(helperUndoSpec(s, "t1")).toBeNull();
  });

  it("is one undo step of its own, apart from the typing before it", () => {
    let s = start("hello");
    s = s.update({ changes: { from: 5, insert: " world" }, userEvent: "input.type" }).state;
    s = edit(s, "t1", [{ op: "replace", find: "hello", replace: "Hello" }]);
    expect(s.doc.toString()).toBe("Hello world");
    let next = s;
    undo({ state: s, dispatch: (tr) => (next = tr.state) });
    expect(next.doc.toString()).toBe("hello world");
  });
});
