import { describe, it, expect } from "vitest";
import { buildSlidesHtml } from "~/lib/slides-build";

const build = (md: string) =>
  buildSlidesHtml(md, {
    drive: { fileId: "DECKID", name: "slides.qmd", folderId: "FOLDERID" },
    origin: "https://mist.example",
    driveToken: "TOK",
    bust: 1,
  });

describe("slide image proxying (Drive)", () => {
  it("proxies a slide background via the reveal markdown comment, even on the first slide", () => {
    // The heading is the first content after the frontmatter (a leading blank
    // line used to swallow its attributes).
    const md = [
      "---",
      "format: revealjs",
      "---",
      "",
      '## A causal map {.no-title background-image="../_shared/img/intrac-map-final.png" background-size="contain"}',
      "",
      "body",
    ].join("\n");
    const html = build(md);
    expect(html).toMatch(
      /<!-- \.slide: [^>]*data-background-image="https:\/\/mist\.example\/drive\/asset\?[^"]*intrac-map-final\.png[^"]*"/,
    );
    // the `.no-title` class survives; a file extension must not become a class
    expect(html).toMatch(/class="no-title"/);
    expect(html).not.toMatch(/class="[^"]*\bpng\b/);
  });

  it("proxies markdown images through /drive/asset", () => {
    const html = build('---\nformat: revealjs\n---\n\n# T\n\n![](../_shared/img/a.png)\n');
    const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    for (const src of imgs) expect(src).toMatch(/\/drive\/asset\?/);
  });
});
