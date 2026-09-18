import { describe, it, expect } from "vitest";
import { shareLink, deckViewLink } from "~/components/ShareButton";

const HREF = "https://m.example/docs/test-doc?k=old-key";

describe("shareLink", () => {
  it("builds a plain key link by default", () => {
    expect(shareLink(HREF, "EK", false)).toBe("https://m.example/docs/test-doc?k=EK");
  });

  it("appends view=preview when asked to open in Preview", () => {
    expect(shareLink(HREF, "SK", true)).toBe("https://m.example/docs/test-doc?k=SK&view=preview");
  });

  it("drops the query entirely when there is no key and no preview", () => {
    expect(shareLink(HREF, null, false)).toBe("https://m.example/docs/test-doc");
  });

  it("keeps view=preview even without a key", () => {
    expect(shareLink(HREF, null, true)).toBe("https://m.example/docs/test-doc?view=preview");
  });
});

/**
 * The deck viewer link: the same standalone /slides/:id page "Print to PDF"
 * already opens (minus print-pdf), which `resolveDoc` gates on the doc's own
 * key alone, no Google sign-in. This is what makes "Open link as preview" a
 * genuine no-sign-in link for a deck shared with anyone with the link, unlike
 * /docs/:id?view=preview which always requires a signed-in Google account the
 * Drive file's sharing grants.
 */
describe("deckViewLink", () => {
  it("points at /slides/:id with the key and asset token", () => {
    expect(deckViewLink("https://m.example", "test-doc", "SK", "AT")).toBe(
      "https://m.example/slides/test-doc?k=SK&token=AT",
    );
  });

  it("omits k and token when absent, rather than writing an empty value", () => {
    expect(deckViewLink("https://m.example", "test-doc", null, null)).toBe(
      "https://m.example/slides/test-doc",
    );
  });
});
