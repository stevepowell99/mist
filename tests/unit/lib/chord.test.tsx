// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, Fragment } from "react";
import { render, cleanup } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { chordKeys, runChord, useChords, type Chord } from "~/lib/chord";

/**
 * The one chord registry: every Ctrl/Cmd+Alt handler registers there, and the
 * window's keys, CodeMirror and the deck's iframe all feed it.
 */

afterEach(cleanup);

function Registers({ chords }: { chords: Chord[] }) {
  useChords(chords);
  return null;
}
const mount = (...sets: Chord[][]) =>
  render(createElement(Fragment, null, ...sets.map((chords, i) => createElement(Registers, { key: i, chords }))));

const chord = (key: string, init: Partial<Chord> = {}): Chord => ({
  key,
  label: `chord ${key}`,
  group: "panels",
  run: vi.fn(),
  ...init,
});

const press = (target: EventTarget, code: string) => {
  const e = new KeyboardEvent("keydown", { key: code.slice(-1).toLowerCase(), code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
const fromDeck = (key: string) =>
  window.dispatchEvent(new MessageEvent("message", { data: { type: "mist-key", chord: key } }));

describe("chord registry", () => {
  it("runs a chord pressed on the page and takes the key from the browser", () => {
    const d = chord("d");
    mount([d]);
    const e = press(document.body, "KeyD");
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("runs a chord the deck forwards, unless it needs the editor", () => {
    const d = chord("d");
    const m = chord("m", { deck: false });
    mount([d, m]);
    fromDeck("d");
    fromDeck("m");
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(m.run).not.toHaveBeenCalled();
    press(document.body, "KeyM");
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("tries the latest registration first, and an earlier one when it declines", () => {
    const first = chord("p");
    const declines = chord("p", { run: vi.fn(() => false) });
    mount([first], [declines]);
    expect(runChord("p", "keys")).toBe(true);
    expect(declines.run).toHaveBeenCalledTimes(1);
    expect(first.run).toHaveBeenCalledTimes(1);
  });

  it("ranks a fallback below the page's own meaning, whichever mounted last", () => {
    const toSlide = chord("g");
    const goToLine = chord("g", { fallback: true });
    mount([toSlide], [goToLine]);
    runChord("g", "keys");
    expect(toSlide.run).toHaveBeenCalledTimes(1);
    expect(goToLine.run).not.toHaveBeenCalled();
  });

  it("forgets a chord when its component unmounts", () => {
    const d = chord("d");
    const { unmount } = mount([d]);
    unmount();
    expect(runChord("d", "keys")).toBe(false);
    press(document.body, "KeyD");
    expect(d.run).not.toHaveBeenCalled();
  });

  it("runs a chord pressed in CodeMirror once, and leaves an unregistered one to CodeMirror", () => {
    const d = chord("d");
    mount([d]);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "text", extensions: [chordKeys] }), parent });
    press(view.contentDOM, "KeyD");
    expect(d.run).toHaveBeenCalledTimes(1);
    const unregistered = press(view.contentDOM, "BracketLeft");
    expect(unregistered.defaultPrevented).toBe(false);
    view.destroy();
    parent.remove();
  });
});
