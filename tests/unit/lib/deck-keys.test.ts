// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { deckKeys } from "~/lib/deck-keys";
import { deckRuntimeScript } from "~/lib/slides-runtime";

const script = deckRuntimeScript({ slideNumber: "false", navigationMode: "linear", separateFragments: true });
const labels = (place: "editor" | "page") => deckKeys(place).map((k) => `${k.keys.join("+")}: ${k.label}`);

describe("deck key table", () => {
  it("gives F, Esc and S the meaning each place really has", () => {
    expect(labels("editor")).toContain("F: Present; in Present, full screen");
    expect(labels("page")).toContain("F: Full screen");
    expect(labels("editor").some((l) => l.startsWith("S:"))).toBe(false);
    expect(labels("page").some((l) => l.startsWith("S:"))).toBe(true);
    expect(labels("page").some((l) => l.includes("Alt+…"))).toBe(false);
  });

  it("lists ? in both places", () => {
    for (const place of ["editor", "page"] as const) {
      expect(deckKeys(place).some((k) => k.keys[0] === "?")).toBe(true);
    }
  });
});

// Run the real runtime script in jsdom with a stand-in reveal, as the
// standalone /slides page does (jsdom's window is its own parent, so the script
// takes itself to be standalone).
describe("deck runtime on the standalone page", () => {
  let config: Record<string, unknown> = {};

  beforeAll(async () => {
    const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number };
    if (!g.requestAnimationFrame) g.requestAnimationFrame = (cb) => setTimeout(cb, 0) as unknown as number;
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section>One</section></div></div>';
    const reveal = {
      initialize: (c: Record<string, unknown>) => {
        config = c;
        return Promise.resolve();
      },
      on: () => {},
      off: () => {},
      layout: () => {},
      sync: () => {},
      isOverview: () => false,
      getSlides: () => [],
      getCurrentSlide: () => null,
      getIndices: () => ({ h: 0, v: 0 }),
    };
    new Function("Reveal", "RevealMarkdown", "RevealNotes", script)(reveal, {}, {});
    await new Promise((r) => setTimeout(r, 0));
  });

  it("turns reveal's own help off", () => {
    expect(config.help).toBe(false);
  });

  it("opens and closes its own key list on ?, Esc and the Keys button", () => {
    const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const overlay = () => document.getElementById("mist-key-help");

    press("?");
    const rows = Array.from(overlay()!.querySelectorAll("[role=dialog] > div")).slice(1);
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(deckKeys("page").map((k) => k.label));

    press("?");
    expect(overlay()).toBeNull();

    press("F1");
    expect(overlay()).not.toBeNull();
    press("Escape");
    expect(overlay()).toBeNull();

    const keysButton = Array.from(document.querySelectorAll("#mist-deck-controls button")).find((b) => b.textContent === "Keys");
    (keysButton as HTMLButtonElement).click();
    expect(overlay()).not.toBeNull();
  });
});
