import { describe, it, expect } from "vitest";
import { stripMistBanner, withMistBanner } from "~/shared/mist-banner";

describe("withMistBanner / stripMistBanner", () => {
  it("injects a banner and strips back to the original", () => {
    const md = "# Title\n\nBody text.";
    const withBanner = withMistBanner(md);
    expect(withBanner).toContain("mist:banner:start");
    expect(withBanner).toContain("[!warning]");
    expect(withBanner.startsWith("<!-- mist:banner:start -->")).toBe(true);
    expect(stripMistBanner(withBanner)).toBe(md);
  });

  it("places the banner after YAML frontmatter", () => {
    const md = "---\ntitle: X\n---\n# Heading\n";
    const out = withMistBanner(md);
    expect(out.startsWith("---\ntitle: X\n---\n")).toBe(true);
    expect(out.indexOf("mist:banner:start")).toBeGreaterThan(out.indexOf("title: X"));
    expect(stripMistBanner(out)).toBe(md);
  });

  it("does not duplicate the banner when applied twice", () => {
    const once = withMistBanner("body");
    const twice = withMistBanner(once);
    expect((twice.match(/mist:banner:start/g) ?? []).length).toBe(1);
  });

  it("leaves banner-free text unchanged when stripping", () => {
    expect(stripMistBanner("plain text")).toBe("plain text");
  });
});
