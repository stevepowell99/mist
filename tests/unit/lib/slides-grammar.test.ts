import { describe, it, expect } from "vitest";
import { applyGrammar } from "~/lib/slides-build";

/**
 * applyGrammar is the single composable-grammar pipeline shared by the deck
 * build, the document Preview and the library thumbnails. These lock in the
 * behaviour the three call sites rely on, including the bignums/wikilinks that a
 * drifted copy of the chain previously dropped in thumbnails.
 */
describe("applyGrammar", () => {
  it("enlarges the first word of each .bignums item (the thumbnail-bug fix)", () => {
    const out = applyGrammar("::: {.bignums}\n\n- 80% of people\n- 3x faster\n\n:::");
    expect(out).toContain('<span class="fig">80%</span>');
    expect(out).toContain('<span class="fig">3x</span>');
  });

  it("resolves wikilinks only when asked", () => {
    expect(applyGrammar("see [[Topic]]")).toContain("[[Topic]]");
    expect(applyGrammar("see [[Topic]]", { wikilinks: true })).toContain('class="md-wikilink"');
  });

  it("converts inline spans and fenced divs", () => {
    expect(applyGrammar("[hi]{.flare .teal}")).toContain('<span class="flare teal">hi</span>');
    const div = applyGrammar("::: {.panel .blue}\n\ntext\n\n:::");
    expect(div).toContain('<div class="panel blue">');
  });

  it("leaves grammar shown inside code untouched", () => {
    const out = applyGrammar("`[x]{.y}` and a span [x]{.y}");
    expect(out).toContain("`[x]{.y}`");
    expect(out).toContain('<span class="y">x</span>');
  });

  it("runs afterConvert before code is restored", () => {
    // afterConvert sees the converted-but-still-masked text; a heading attr strip
    // must not touch a `{.x}` that lives inside restored code.
    const out = applyGrammar("## Title {#id}\n\n`{.bar}`", { afterConvert: (t) => t.replace(/\s*\{#[^}]*\}\s*$/m, "") });
    expect(out).toContain("## Title");
    expect(out).not.toContain("{#id}");
    expect(out).toContain("`{.bar}`");
  });
});
