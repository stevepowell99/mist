import { describe, it, expect } from "vitest";
import { slideSpans } from "~/lib/slides-build";

/**
 * `slideSpans` is the offset-carrying sibling of `splitSlides` (same split:
 * level-1/2 headings and standalone `---` rules), used by the live-preview
 * slide widget to map a rendered slide back to the source range it replaces.
 * Every span's `text` must equal `body.slice(from, to)`, or the widget would
 * hide the wrong characters; that's the one property these lock in, checked
 * alongside the split points themselves (trimmed, since neither this nor the
 * original `splitSlides` strips the blank line a boundary leaves behind).
 */
function checkRoundtrip(body: string) {
  for (const span of slideSpans(body)) {
    expect(body.slice(span.from, span.to)).toBe(span.text);
  }
}

describe("slideSpans", () => {
  it("splits on level-1/2 headings, offsets round-tripping through the body", () => {
    const body = "# One\n\nfirst\n\n## Two\n\nsecond\n";
    const spans = slideSpans(body);
    expect(spans.map((s) => s.text.trim())).toEqual(["# One\n\nfirst", "## Two\n\nsecond"]);
    checkRoundtrip(body);
  });

  it("splits on a standalone --- rule, dropping the rule line itself", () => {
    const body = "first\n\n---\n\nsecond\n";
    const spans = slideSpans(body);
    expect(spans.map((s) => s.text.trim())).toEqual(["first", "second"]);
    checkRoundtrip(body);
  });

  it("a document with no heading or rule is one slide, the whole body", () => {
    const body = "just some text\nover two lines\n";
    const spans = slideSpans(body);
    expect(spans).toEqual([{ from: 0, to: body.length, text: body }]);
  });

  it("drops a blank trailing chunk rather than emitting an empty slide", () => {
    const body = "# One\n\nfirst\n\n---\n\n\n";
    const spans = slideSpans(body);
    expect(spans.map((s) => s.text.trim())).toEqual(["# One\n\nfirst"]);
    checkRoundtrip(body);
  });

  it("a heading with nothing before it starts the first slide, not an empty one", () => {
    const body = "# Title\n\ncontent\n\n# Next\n\nmore\n";
    const spans = slideSpans(body);
    expect(spans.map((s) => s.text.trim())).toEqual(["# Title\n\ncontent", "# Next\n\nmore"]);
    checkRoundtrip(body);
  });
});
