import { describe, it, expect } from "vitest";
import { resolveThemeName, THEME_NAMES, DEFAULT_THEME } from "~/lib/themes";
import { buildSlidesHtml } from "~/lib/slides-build";

// NOTE: `?raw` CSS imports resolve to "" in this vitest env (same as
// deck-base.css?raw), so the theme CSS *content* cannot be asserted here; it is
// verified visually against the deployed worker. These tests lock the
// resolution logic and the structural wiring (our theme in, reveal's theme out).

describe("theme resolution", () => {
  it("defaults to causal-map when no theme is given", () => {
    expect(resolveThemeName("")).toBe(DEFAULT_THEME);
    expect(resolveThemeName("title: x")).toBe(DEFAULT_THEME);
  });
  it("reads a known theme, case- and quote-insensitive", () => {
    expect(resolveThemeName("theme: qualia")).toBe("qualia");
    expect(resolveThemeName('theme: "Brutalist"')).toBe("brutalist");
    expect(resolveThemeName("theme: [editorial, x]")).toBe("editorial");
  });
  it("falls back to default for an unknown theme (e.g. old reveal names)", () => {
    expect(resolveThemeName("theme: black")).toBe(DEFAULT_THEME);
  });
  it("ships the expected theme set", () => {
    expect(THEME_NAMES).toEqual(["causal-map", "qualia", "brutalist", "editorial"]);
  });
});

describe("buildSlidesHtml theme wiring", () => {
  const opts = { drive: null, origin: "", driveToken: "", bust: "t" };
  it("injects our theme block and drops the reveal.js theme CDN link", () => {
    const html = buildSlidesHtml("---\ntheme: brutalist\n---\n\n# Hi\n", opts);
    expect(html).toContain('id="deck-theme"');
    expect(html).not.toContain("reveal.js@5.1.0/dist/theme/");
    expect(html).toContain("reveal.js@5.1.0/dist/reveal.css"); // core still loads
  });
});
