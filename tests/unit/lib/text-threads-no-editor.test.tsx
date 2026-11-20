// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { useTextThreads } from "~/lib/useTextThreads";

const user = { name: "Carol", color: "#81C784", colorLight: "#81C78433" };

/** Present unmounts the editor, so a slide comment made there has no view to
 *  dispatch through and must go straight into the Y.Text. */
describe("createComment without an editor", () => {
  it("writes a slide comment into the Y.Text and records its thread", () => {
    const doc = new Y.Doc();
    const text = "## A\n\nBody\n";
    doc.getText("body").insert(0, text);
    const { result } = renderHook(() => useTextThreads({ doc, view: null, text, user }));
    act(() => result.current.createComment("Is this right?", { slide: 0 }));
    expect(doc.getText("body").toString()).toBe("## A\n{>>Is this right?<<}\n\nBody\n");
    const threads = [...doc.getMap<string>("threads").values()].map((v) => JSON.parse(v));
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ commentText: "Is this right?", author: { name: "Carol" }, resolved: false });
  });

  it("ignores a selection comment, which needs the editor", () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "text");
    const { result } = renderHook(() => useTextThreads({ doc, view: null, text: "text", user }));
    act(() => result.current.createComment("note", { from: 0, to: 4 }));
    expect(doc.getText("body").toString()).toBe("text");
    expect(doc.getMap("threads").size).toBe(0);
  });
});
