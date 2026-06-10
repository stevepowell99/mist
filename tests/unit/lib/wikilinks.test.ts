import { describe, it, expect } from "vitest";
import { renderWikiLinks, wikiLinkDisplay, wikiLinkPageId } from "~/lib/wikilinks";

describe("wikiLinkDisplay", () => {
  it("uses the alias when given", () => {
    expect(wikiLinkDisplay("005 Minimalist ((minimalist))|the minimalist coding stance")).toBe(
      "the minimalist coding stance",
    );
  });
  it("uses the target when there is no alias", () => {
    expect(wikiLinkDisplay("Some Note")).toBe("Some Note");
  });
  it("strips a #heading from a bare target", () => {
    expect(wikiLinkDisplay("Note#Section")).toBe("Note");
  });
});

describe("renderWikiLinks", () => {
  it("renders the alias inside a wikilink span", () => {
    expect(renderWikiLinks("see [[005 X ((x))|the X stance]] here")).toBe(
      'see <span class="md-wikilink">the X stance</span> here',
    );
  });
  it("renders a bare target", () => {
    expect(renderWikiLinks("[[Some Note]]")).toBe('<span class="md-wikilink">Some Note</span>');
  });
  it("handles embed-style ![[note]] (non-image)", () => {
    expect(renderWikiLinks("![[Some Note]]")).toBe('<span class="md-wikilink">Some Note</span>');
  });
  it("escapes HTML in the display text", () => {
    expect(renderWikiLinks("[[a<b>c]]")).toContain("a&lt;b&gt;c");
  });
  it("leaves normal markdown links untouched", () => {
    expect(renderWikiLinks("[text](url)")).toBe("[text](url)");
  });

  it("links to the published site when a ((id)) and siteBase are present", () => {
    const out = renderWikiLinks("[[005 X ((minimalist))|the stance]]", "https://garden.causalmap.app");
    expect(out).toBe(
      '<a class="md-wikilink" href="https://garden.causalmap.app/minimalist/" target="_blank" rel="noopener noreferrer">the stance</a>',
    );
  });

  it("stays a non-clickable span without a ((id))", () => {
    const out = renderWikiLinks("[[Some Note]]", "https://garden.causalmap.app");
    expect(out).toBe('<span class="md-wikilink">Some Note</span>');
  });
});

describe("wikiLinkPageId", () => {
  it("extracts a trailing ((id))", () => {
    expect(wikiLinkPageId("005 Minimalist ((minimalist))|alias")).toBe("minimalist");
  });
  it("returns null when absent", () => {
    expect(wikiLinkPageId("Plain Note")).toBeNull();
  });
});
