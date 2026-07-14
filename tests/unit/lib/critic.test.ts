import { describe, it, expect } from "vitest";
import { renderCriticHtml, stripCritic } from "~/lib/critic";
import { listSuggestions } from "~/lib/cm-suggestion-actions";

describe("renderCriticHtml", () => {
  it("renders additions, deletions and highlights, and drops comments", () => {
    expect(renderCriticHtml("a {++new++} b")).toBe('a <span class="cm-addition">new</span> b');
    expect(renderCriticHtml("a {--old--} b")).toBe('a <span class="cm-deletion">old</span> b');
    expect(renderCriticHtml("a {==hi==} b")).toBe('a <span class="cm-highlight">hi</span> b');
    expect(renderCriticHtml("a {>>note<<} b")).toBe("a  b");
  });

  it("renders a substitution as old + new, leaving no delimiters for markdown", () => {
    // The `~~` used to reach marked and render as strikethrough, leaving the
    // braces and `~>` visible in the preview.
    const html = renderCriticHtml("would {~~like~>likely~~} code");
    expect(html).toBe(
      'would <span class="cm-deletion">like</span><span class="cm-addition">likely</span> code',
    );
    expect(html).not.toMatch(/[{}]|~[>~]/);
  });

  it("handles a substitution spanning lines", () => {
    expect(renderCriticHtml("x {~~a\nb~>c\nd~~} y")).toBe(
      'x <span class="cm-deletion">a\nb</span><span class="cm-addition">c\nd</span> y',
    );
  });
});

describe("stripCritic", () => {
  it("accepts suggestions and drops comments", () => {
    expect(stripCritic("a {++new++} {--old--} {==hi==} {>>note<<}b")).toBe("a new  hi b");
    expect(stripCritic("would {~~like~>likely~~} code")).toBe("would likely code");
  });
});

describe("listSuggestions", () => {
  it("pairs an edit with the comment written beside it, either side", () => {
    const items = listSuggestions("a {--old--}{>>why<<} b {>>because<<} {++new++} c");
    expect(items.map((i) => [i.type, i.commentText])).toEqual([
      ["deletion", "why"],
      ["addition", "because"],
    ]);
  });

  it("does not pair a comment that is not touching the edit", () => {
    expect(listSuggestions("{--old--} some text {>>unrelated<<}")[0].commentText).toBeUndefined();
  });
});
