import { describe, it, expect } from "vitest";
import { shareLink } from "~/components/ShareButton";

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
