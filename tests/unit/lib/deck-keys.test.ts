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

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const SLIDES = '<div class="reveal"><div class="slides"><section>One</section></div></div>';

/** A stand-in for reveal: enough API for the runtime to boot, and the config it was given. */
function fakeReveal(onInit: (config: Record<string, unknown>) => void) {
  return {
    initialize: (c: Record<string, unknown>) => {
      onInit(c);
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
}

type RuntimeWindow = Window & {
  Function: FunctionConstructor;
  KeyboardEvent: typeof KeyboardEvent;
  requestAnimationFrame?: (cb: () => void) => number;
};

/** Run the real runtime script in `win`, as the deck page's last script does. */
function boot(win: RuntimeWindow, onInit: (config: Record<string, unknown>) => void = () => {}) {
  if (!win.requestAnimationFrame) win.requestAnimationFrame = (cb) => setTimeout(cb, 0) as unknown as number;
  win.document.body.innerHTML = SLIDES;
  new win.Function("Reveal", "RevealMarkdown", "RevealNotes", script)(fakeReveal(onInit), {}, {});
}

// As the standalone /slides page runs it: jsdom's top window is its own parent,
// so the script takes itself to be standalone.
describe("deck runtime on the standalone page", () => {
  let config: Record<string, unknown> = {};

  beforeAll(async () => {
    boot(window as unknown as RuntimeWindow, (c) => (config = c));
    await tick();
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

// As an editor's preview and Present run it: inside an iframe, whose keys never
// reach the app, so the runtime posts what the app must act on.
describe("deck runtime embedded in an editor", () => {
  let frame: RuntimeWindow;
  const received: unknown[] = [];
  const onMessage = (e: MessageEvent) => received.push(e.data);
  const press = (win: RuntimeWindow, key: string) =>
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const sent = async (win: RuntimeWindow, key: string) => {
    received.length = 0;
    press(win, key);
    await tick(10);
    return [...received];
  };

  beforeAll(async () => {
    const el = document.createElement("iframe");
    document.body.append(el);
    frame = el.contentWindow as unknown as RuntimeWindow;
    window.addEventListener("message", onMessage);
    boot(frame);
    await tick();
  });

  it("sends plain D up as the outline chord, which the editors' chord path runs", async () => {
    expect(await sent(frame, "d")).toContainEqual({ type: "mist-key", chord: "d" });
    expect(deckKeys("editor").some((k) => k.keys.join() === "D")).toBe(true);
  });

  it("leaves D alone on the standalone page, which has no outline", async () => {
    expect(await sent(window as unknown as RuntimeWindow, "d")).toEqual([]);
    expect(deckKeys("page").some((k) => k.keys.join() === "D")).toBe(false);
  });

  it("sends ? up to the app's Help panel instead of drawing its own list", async () => {
    expect(await sent(frame, "?")).toContainEqual({ type: "mist-help" });
    expect(frame.document.getElementById("mist-key-help")).toBeNull();
  });
});
