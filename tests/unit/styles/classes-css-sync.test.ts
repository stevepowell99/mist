import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate, BEGIN, END } from "../../../scripts/gen-styles.mjs";

/**
 * classes.json (the machine-readable catalogue that drives the `.` picker and the
 * Help axes) and deck-base.css (the actual selectors) are kept in step two ways,
 * and this test guards both. The hand-written appearance axes
 * (component/colour/shade) must each have a real selector in the CSS. The stepped
 * numeric axes (scale/opacity/width/height/place) are GENERATED into a marked
 * region of the CSS by scripts/gen-styles.mjs from the manifest, so this test also
 * asserts that region matches the manifest output (a stale commit fails CI; run
 * `npm run gen:styles`). Read from disk, not `?raw` (which resolves to "" under
 * vitest).
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const manifestText = read("../../../app/styles/classes.json");
const catalogue = JSON.parse(manifestText) as {
  axes: Record<string, { classes?: Record<string, string> }>;
};
const css = read("../../../app/styles/deck-base.css");

/** A literal `.name` selector somewhere in the stylesheet (word-boundaried so
 *  `.card` does not match `.cards`). */
function hasSelector(name: string): boolean {
  return new RegExp(`\\.${name.replace(/-/g, "\\-")}(?![\\w-])`).test(css);
}

describe("classes.json stays in step with deck-base.css", () => {
  for (const axis of ["component", "colour", "shade"]) {
    const names = Object.keys(catalogue.axes[axis]?.classes ?? {});
    it(`every ${axis} class has a deck-base.css selector`, () => {
      const missing = names.filter((n) => !hasSelector(n));
      expect(missing).toEqual([]);
    });
  }

  it("the GENERATED stepped-utility region matches the manifest", () => {
    const region = css.slice(css.indexOf(BEGIN), css.indexOf(END) + END.length);
    expect(css).toContain(BEGIN);
    expect(css).toContain(END);
    expect(region).toBe(generate(JSON.parse(manifestText)));
  });
});
