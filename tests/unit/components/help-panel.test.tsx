// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import HelpPanel from "~/components/HelpPanel";

// The intro shows on the first ten loads; count them as done so it stays out of the way.
beforeEach(() => localStorage.setItem("mistHelpIntroLoads", "10"));
afterEach(cleanup);

const fromDeck = () =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "mist-help" } }));
  });

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
    expect(screen.getByText("Go to line")).toBeTruthy();
    expect(screen.queryByText("Drive folder sidebar (Drive files)")).toBeNull();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("Files")).toBeNull();
  });
});
