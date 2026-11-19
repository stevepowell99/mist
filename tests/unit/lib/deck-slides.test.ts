import { describe, it, expect } from "vitest";
import { deckSlides } from "~/lib/slides-build";

/** deckSlides names each slide for the speaker notes and the library's "from a deck" tab. */
describe("deckSlides titles", () => {
  it("takes the heading's text without its attributes", () => {
    expect(deckSlides("## Results {.center}\n\nBody")[0].title).toBe("Results");
  });

  it("skips an attributes-only heading and names the slide by its content", () => {
    const md = "## {.title-page .center .align-middle}\n\n::: {.big}\nCausal mapping at scale\n:::\n";
    expect(deckSlides(md)[0].title).toBe("Causal mapping at scale");
  });

  it("uses a later heading with text over the content", () => {
    expect(deckSlides("## {.no-title}\n\n### Method\n\nText")[0].title).toBe("Method");
  });

  it("numbers a slide that holds nothing to name it by", () => {
    expect(deckSlides("## One\n\n---\n\n## {.no-title}\n")[1].title).toBe("Slide 2");
  });
});
