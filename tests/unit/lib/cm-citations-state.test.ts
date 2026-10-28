// @vitest-environment jsdom
// (DOMPurify, which the slide render goes through, needs a DOM.)
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { bibField, bibOf, setBib } from "~/lib/cm-citations";
import { parseBib } from "~/lib/citations";
import { slideLiveHtml } from "~/lib/slide-thumb";

const BIB = parseBib(
  "@book{axelrod1976, title = {Structure of Decision}, author = {Axelrod, Robert}, year = {1976}, publisher = {Princeton}}",
);

describe("the bib library as editor state", () => {
  it("starts empty and takes the library from a setBib effect", () => {
    const state = EditorState.create({ doc: "x", extensions: [bibField] });
    expect(bibOf(state)).toBeNull();
    const next = state.update({ effects: setBib.of(BIB) }).state;
    expect(bibOf(next)).toBe(BIB);
  });

  it("reads null, without throwing, from an editor built without the field", () => {
    expect(bibOf(EditorState.create({ doc: "x" }))).toBeNull();
  });
});

describe("a live-preview slide card", () => {
  it("shows a citation as the reference when it has the library", () => {
    const html = slideLiveHtml("## Slide\n\nMaps [@axelrod1976].", BIB);
    expect(html).toContain("Axelrod 1976");
    expect(html).not.toContain("@axelrod1976");
  });

  it("leaves the key as written without one", () => {
    expect(slideLiveHtml("## Slide\n\nMaps [@axelrod1976].")).toContain("@axelrod1976");
  });
});
