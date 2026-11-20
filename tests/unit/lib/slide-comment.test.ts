import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { slideCommentChange } from "~/lib/cm-comments";
import { suggestMode } from "~/lib/cm-suggest";
import { offsetForDeckIndex } from "~/lib/slide-cursor";
import { buildSlideSections } from "~/lib/slides-build";

/** Apply the change for a comment on the slide starting at `needle`. */
function comment(text: string, needle: string, note = "note"): string {
  const { changes } = slideCommentChange(text, text.indexOf(needle), note);
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

describe("slideCommentChange", () => {
  it("puts the comment on its own line after the heading, keeping the heading's attributes", () => {
    expect(comment("## Results {.center}\n\nBody\n", "## Results")).toBe("## Results {.center}\n{>>note<<}\n\nBody\n");
  });

  it("keeps a blank line between the comment and content right under the heading", () => {
    expect(comment("## Results\n- one\n", "## Results")).toBe("## Results\n{>>note<<}\n\n- one\n");
  });

  it("adds a later comment below the earlier ones", () => {
    const once = comment("## A\n\nBody\n", "## A", "first");
    expect(comment(once, "## A", "second")).toBe("## A\n{>>first<<}\n{>>second<<}\n\nBody\n");
  });

  it("puts it above the first line of a slide with no heading", () => {
    expect(comment("## A\n\na\n\n---\n\nPlain slide\n", "Plain slide")).toBe("## A\n\na\n\n---\n\n{>>note<<}\n\nPlain slide\n");
  });

  it("works on a heading at the very end of the document", () => {
    expect(comment("## A\n\na\n\n## Last", "## Last")).toBe("## A\n\na\n\n## Last\n{>>note<<}");
  });

  it("goes after a suggestion that holds the heading, never inside it", () => {
    const text = "## A\n\na\n\n{++## New\n\nnew++}\n\nmore\n";
    // The deck places the slide's first line inside the addition, after `{++`.
    const start = offsetForDeckIndex(text, 1)!;
    const { changes } = slideCommentChange(text, start, "note");
    const out = text.slice(0, changes[0].from) + changes[0].insert + text.slice(changes[0].to);
    expect(out).toBe("## A\n\na\n\n{++## New\n\nnew++}\n{>>note<<}\n\nmore\n");
  });

  it("leaves the deck unchanged, since the comment is stripped", () => {
    const text = "## Results {.center}\n\nBody\n";
    const opts = { drive: null, origin: "", driveToken: "", bust: "", docFrontmatter: "" };
    const strip = (html: string) => html.replace(/\n+/g, "\n");
    expect(strip(buildSlideSections(comment(text, "## Results"), opts))).toBe(strip(buildSlideSections(text, opts)));
  });
});

describe("a suggester's slide comment", () => {
  it("passes through suggest mode as a comment, not a {++ ++} suggestion", () => {
    const doc = "## A\n\nBody\n";
    let state = EditorState.create({ doc, extensions: [suggestMode(() => "suggest")] });
    const { changes } = slideCommentChange(doc, 0, "note");
    state = state.update({ changes, userEvent: "input.comment" }).state;
    expect(state.doc.toString()).toBe("## A\n{>>note<<}\n\nBody\n");
  });
});
