// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, Fragment } from "react";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import HelpPanel from "~/components/HelpPanel";
import { useChords, type Chord } from "~/lib/chord";

// The intro shows on the first ten loads; count them as done so it stays out of the way.
beforeEach(() => localStorage.setItem("mistHelpIntroLoads", "10"));
afterEach(cleanup);

const fromDeck = () =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "mist-help" } }));
  });

/** Registers chords, as an editor or panel does while mounted. */
function Registers({ chords }: { chords: Chord[] }) {
  useChords(chords);
  return null;
}

const comment: Chord = { key: "m", label: "Comment on the selection", group: "editor", deck: false, run: () => {} };
const goToLine: Chord = { key: "g", label: "Go to line", group: "editor", deck: false, fallback: true, run: () => {} };
const toSlide: Chord = { key: "g", label: "Editor to the shown slide", group: "panels", run: () => {} };
const outline: Chord = { key: "d", label: "Outline / slide list", group: "panels", run: () => {} };

describe("HelpPanel", () => {
  it("opens at its Shortcuts tab when ? is pressed in a deck", () => {
    render(createElement(HelpPanel));
    expect(screen.queryByRole("dialog")).toBeNull();
    fromDeck();
    expect(screen.getByText("Deck (focus in the preview or Present)")).toBeTruthy();
    expect(screen.getByText("Present; in Present, full screen")).toBeTruthy();
    // The keys the standalone page has, and the editor's deck does not.
    expect(screen.queryByText("Speaker view: notes, next slide and timer, in a second window")).toBeNull();
  });

  it("closes on Esc without letting the Esc reach anything else", () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    render(createElement(HelpPanel));
    fromDeck();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener("keydown", behind);
  });

  it("drops the rows and tabs a local file does not have", () => {
    render(createElement(HelpPanel, { editor: "local" }));
    fromDeck();
    expect(screen.queryByText("Rebuild the deck preview now")).toBeNull();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("Files")).toBeNull();
  });

  it("lists exactly the chords registered on the page, with their handlers' labels", () => {
    const page = (chords: Chord[]) =>
      createElement(Fragment, null, createElement(Registers, { chords }), createElement(HelpPanel));
    const { rerender } = render(page([comment, goToLine, toSlide, outline]));
    fromDeck();
    // G means what the page made it mean: the slide jump, not CodeMirror's fallback.
    expect(screen.getByText("Editor to the shown slide")).toBeTruthy();
    expect(screen.queryByText("Go to line")).toBeNull();
    expect(screen.getByText("Comment on the selection")).toBeTruthy();
    expect(screen.getByText("This help")).toBeTruthy();
    // Rows about what a chord opens appear with it, and not without it.
    expect(screen.getByText(/drag a row's grip/)).toBeTruthy();
    expect(screen.queryByText(/In Quick open/)).toBeNull();
    // The deck row names the chords the deck cannot use.
    expect(screen.getByText("The Ctrl/⌘+Alt shortcuts work with the focus in the deck too, except M")).toBeTruthy();

    rerender(page([comment, goToLine]));
    expect(screen.getByText("Go to line")).toBeTruthy();
    expect(screen.queryByText("Outline / slide list")).toBeNull();
    expect(screen.getByText("The Ctrl/⌘+Alt shortcuts work with the focus in the deck too, except G and M")).toBeTruthy();
  });
});
