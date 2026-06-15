import { describe, it, expect } from "vitest";
import { isHiddenHeading, headingTitle, toggleHiddenText } from "~/lib/outline";

describe("outline hide/unhide", () => {
  it("detects hidden headings", () => {
    expect(isHiddenHeading('## Slide {visibility="hidden"}')).toBe(true);
    expect(isHiddenHeading("## Slide {.center .hidden}")).toBe(true);
    expect(isHiddenHeading("## Slide {.center}")).toBe(false);
    expect(isHiddenHeading("## Slide")).toBe(false);
  });

  it("reads the display title without the attribute block", () => {
    expect(headingTitle('Slide two {.center background-color="#000"}')).toBe("Slide two");
    expect(headingTitle("Plain heading")).toBe("Plain heading");
    expect(headingTitle("{.center .title-page}")).toBe("untitled");
  });

  it("hides a plain heading by appending the marker", () => {
    expect(toggleHiddenText("## Slide two")).toBe('## Slide two {visibility="hidden"}');
  });

  it("hides a heading that already has an attribute block", () => {
    expect(toggleHiddenText("# Title {.center .title-page}")).toBe(
      '# Title {.center .title-page visibility="hidden"}',
    );
  });

  it("unhides by removing the marker and any empty block", () => {
    expect(toggleHiddenText('## Slide two {visibility="hidden"}')).toBe("## Slide two");
    expect(toggleHiddenText('# Title {.center visibility="hidden"}')).toBe("# Title {.center}");
  });

  it("round-trips hide then unhide", () => {
    const orig = "## Slide {.center}";
    expect(toggleHiddenText(toggleHiddenText(orig))).toBe(orig);
  });
});
