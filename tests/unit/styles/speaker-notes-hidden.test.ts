// @vitest-environment jsdom
// (DOMPurify, which both renders go through, needs a DOM.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { slideLiveHtml, slideNotes, slideThumbHtml } from "~/lib/slide-thumb";

/**
 * Speaker notes must stay OFF the slide wherever a slide is rendered.
 *
 * `::: {.notes}` becomes `aside.notes` rather than a div (parseAttrs in
 * slides-build.ts), and reveal.js hides that inside its own deck. But a slide
 * rendered into a `.preview` box never loads reveal's CSS: the live-preview
 * slide widget, the library thumbnails and the presenter rail's next-slide
 * thumb are all that case, and all three printed the notes onto the slide
 * until deck-base.css said so itself. The rail shows the notes deliberately,
 * separately, through `slideNotes`.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../../../app/styles/deck-base.css");

const SLIDE = "# A slide\n\nOn the slide.\n\n::: {.notes}\n\nOff the slide.\n\n:::\n";

describe("speaker notes", () => {
  it("render as aside.notes, which is what reveal and the CSS both key on", () => {
    for (const html of [slideLiveHtml(SLIDE), slideThumbHtml(SLIDE)]) {
      expect(html).toContain('<aside class="notes">');
      expect(html).toContain("On the slide.");
    }
  });

  it("are hidden in a .preview box, not only inside .reveal", () => {
    // The rule has to reach `.preview`; matching `.reveal` alone is the bug.
    const rule = css
      .split("}")
      .map((block) => block + "}")
      .find((block) => /aside\.notes/.test(block) && /\.preview/.test(block));
    expect(rule, "deck-base.css must hide aside.notes inside .preview").toBeTruthy();
    expect(rule!.replace(/\s/g, "")).toContain("display:none");
  });

  it("are still readable on their own, for the presenter rail", () => {
    expect(slideNotes(SLIDE)).toBe("Off the slide.");
  });
});
