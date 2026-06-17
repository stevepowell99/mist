import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * classes.json (the machine-readable catalogue that drives the `.` picker and the
 * Help axes) and deck-base.css (the actual selectors) are a hand-synced double
 * source of truth: CLAUDE.md notes the generator is not built yet, so this test
 * is the guard against drift. Every hand-maintained component/colour/shade class
 * must have a real selector in deck-base.css, so adding to one file without the
 * other fails here. Read from disk, not `?raw` (which resolves to "" under
 * vitest). Generated step utilities (.scale-*, .top-* …) are out of scope: they
 * are expanded from the manifest, not listed class by class.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const catalogue = JSON.parse(read("../../../app/styles/classes.json")) as {
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
});
