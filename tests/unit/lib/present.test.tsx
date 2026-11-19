// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderHook, act, render, fireEvent } from "@testing-library/react";
import { usePresent, SPEAKER_WINDOW_NAME, stepDeck } from "~/lib/usePresent";
import PresenterRail from "~/components/PresenterRail";

/**
 * Present's two windows: the deck stays here to be shared, and the notes open
 * in a window of their own. jsdom cannot open a window, so an iframe's window
 * stands in for the popup: a real second document, as the portal needs.
 */

let popup: HTMLIFrameElement | null = null;
function fakePopup(): Window {
  popup = document.createElement("iframe");
  document.body.append(popup);
  const w = popup.contentWindow!;
  w.close = vi.fn(() => w.dispatchEvent(new Event("pagehide")));
  w.focus = vi.fn();
  return w;
}

const DECK = "---\nformat: revealjs\n---\n\n## One\n\n::: {.notes}\nSay hello.\n:::\n\n## Two\n\nBody\n";

beforeEach(() => {
  document.head.innerHTML = '<style id="app-css">.bg-paper{}</style>';
  document.documentElement.setAttribute("data-theme", "dark");
});
afterEach(() => {
  popup?.remove();
  popup = null;
  vi.restoreAllMocks();
});

describe("usePresent", () => {
  it("opens the notes in a named popup, dressed in the app's styles and theme", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => fakePopup());
    const { result } = renderHook(() => usePresent(true));
    await act(async () => result.current.enter());
    expect(result.current.presenting).toBe(true);
    expect(open).toHaveBeenCalledWith("", SPEAKER_WINDOW_NAME, expect.stringContaining("popup"));
    const root = result.current.speakerRoot!;
    expect(root).not.toBeNull();
    const d = root.ownerDocument;
    expect(d).not.toBe(document);
    expect(d.getElementById("app-css")).not.toBeNull();
    expect(d.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(result.current.cardOpen).toBe(false);
    expect(result.current.notesShown).toBe(true);
  });

  it("falls back to the card on this screen when no window will open", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => usePresent(true));
    await act(async () => result.current.enter());
    expect(result.current.speakerRoot).toBeNull();
    expect(result.current.cardOpen).toBe(true);
    act(() => result.current.toggleNotes());
    expect(result.current.cardOpen).toBe(false);
  });

  it("does nothing for a document that is not a deck", async () => {
    const open = vi.spyOn(window, "open");
    const { result } = renderHook(() => usePresent(false));
    await act(async () => result.current.enter());
    expect(result.current.presenting).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("closes the notes window on exit, and notices when it is closed by hand", async () => {
    vi.spyOn(window, "open").mockImplementation(() => fakePopup());
    const { result } = renderHook(() => usePresent(true));
    await act(async () => result.current.enter());
    const w = result.current.speakerRoot!.ownerDocument.defaultView!;
    act(() => w.dispatchEvent(new Event("pagehide")));
    expect(result.current.speakerRoot).toBeNull();
    expect(result.current.presenting).toBe(true);
    await act(async () => result.current.toggleNotes());
    expect(result.current.speakerRoot).not.toBeNull();
    const w2 = result.current.speakerRoot!.ownerDocument.defaultView!;
    act(() => result.current.exit());
    expect(result.current.presenting).toBe(false);
    expect(w2.close).toHaveBeenCalled();
  });

  it("ends Present on the deck's forwarded Esc, and enters it on its forwarded F", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => usePresent(true));
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "mist-present" } }));
    });
    expect(result.current.presenting).toBe(true);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "mist-escape" } }));
    });
    expect(result.current.presenting).toBe(false);
  });

  it("ends Present on Esc with the focus in the app", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => usePresent(true));
    await act(async () => result.current.enter());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.presenting).toBe(false);
  });

  it("steps the deck through a window event SlidesView passes on", () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener("mist-deck-nav", on);
    stepDeck("next");
    stepDeck("prev");
    window.removeEventListener("mist-deck-nav", on);
    expect(seen).toEqual(["next", "prev"]);
  });
});

describe("PresenterRail in the speaker window", () => {
  it("shows the slide's notes and steps the deck from its keys and buttons", () => {
    const onStep = vi.fn();
    const onExit = vi.fn();
    const { getByText } = render(
      createElement(PresenterRail, {
        variant: "window",
        markdown: DECK,
        frontmatter: "format: revealjs",
        currentSlide: 0,
        startedAt: Date.now(),
        onStep,
        onExit,
      }),
    );
    expect(getByText("Say hello.")).toBeTruthy();
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.click(getByText("End"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["next", "prev", "next"]);
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("leaves a modified key alone, so the browser's own shortcuts still work", () => {
    const onStep = vi.fn();
    render(
      createElement(PresenterRail, { variant: "window", markdown: DECK, frontmatter: "", currentSlide: 0, startedAt: 0, onStep }),
    );
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    expect(onStep).not.toHaveBeenCalled();
  });
});
