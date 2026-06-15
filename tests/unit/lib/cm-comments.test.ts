import { describe, it, expect } from "vitest";
import {
  scanTextComments,
  insertCommentChange,
  removeCommentChange,
  activeRangeFor,
} from "~/lib/cm-comments";
import { matchThreadsToComments } from "~/lib/comment-threads";
import type { ThreadData } from "~/shared/types";

const author = { name: "A", color: "#000", colorLight: "#000" };
function thread(commentText: string, highlightText?: string): ThreadData {
  return { id: commentText, commentText, highlightText, author, createdAt: 1, resolved: false, replies: [] };
}

function applyChanges(text: string, changes: { from: number; to: number; insert: string }[]): string {
  // apply on original offsets, right-to-left so earlier offsets stay valid
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

describe("scanTextComments", () => {
  it("finds a point comment", () => {
    const c = scanTextComments("hello {>>a note<<} world");
    expect(c).toHaveLength(1);
    expect(c[0].commentText).toBe("a note");
    expect(c[0].highlightText).toBeUndefined();
  });

  it("pairs a comment with its preceding highlight", () => {
    const text = "see {==this bit==}{>>fix it<<} now";
    const c = scanTextComments(text);
    expect(c[0].commentText).toBe("fix it");
    expect(c[0].highlightText).toBe("this bit");
    expect(text.slice(c[0].position, c[0].endPosition)).toBe("{>>fix it<<}");
  });
});

describe("insertCommentChange", () => {
  it("inserts a point comment at the cursor", () => {
    const r = insertCommentChange("ab", 1, 1, "note");
    expect(applyChanges("ab", r.changes)).toBe("a{>>note<<}b");
  });

  it("wraps a selection as highlight + comment", () => {
    const r = insertCommentChange("the cat sat", 4, 7, "which cat?");
    expect(applyChanges("the cat sat", r.changes)).toBe("the {==cat==}{>>which cat?<<} sat");
  });
});

describe("removeCommentChange", () => {
  it("removes a point comment", () => {
    const text = "a{>>note<<}b";
    expect(applyChanges(text, removeCommentChange(text, "note"))).toBe("ab");
  });

  it("removes the comment and unwraps the highlight, keeping the text", () => {
    const text = "the {==cat==}{>>q<<} sat";
    expect(applyChanges(text, removeCommentChange(text, "q", "cat"))).toBe("the cat sat");
  });

  it("returns no change when the comment is gone", () => {
    expect(removeCommentChange("plain text", "missing")).toEqual([]);
  });
});

describe("activeRangeFor", () => {
  it("targets the highlighted text when present", () => {
    const text = "the {==cat==}{>>q<<} sat";
    const r = activeRangeFor(text, "q", "cat")!;
    expect(text.slice(r.from, r.to)).toBe("cat");
  });

  it("targets the comment span for a point comment", () => {
    const text = "a {>>note<<} b";
    const r = activeRangeFor(text, "note")!;
    expect(text.slice(r.from, r.to)).toBe("{>>note<<}");
  });
});

describe("comment survives concurrent edits (no anchor needed)", () => {
  it("re-scans to the new position after an upstream insert", () => {
    const before = "x {==cat==}{>>q<<} y";
    const t = [thread("q", "cat")];
    const m1 = matchThreadsToComments(t, scanTextComments(before));
    const pos1 = m1[0].position!;

    // a collaborator inserts text before the comment; the literal markup moves
    const after = "PREFIX " + before;
    const m2 = matchThreadsToComments(t, scanTextComments(after));
    expect(m2[0].position).toBe(pos1 + "PREFIX ".length);
    expect(after.slice(m2[0].position!, m2[0].endPosition!)).toBe("{>>q<<}");
  });
});
