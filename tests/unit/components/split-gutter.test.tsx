// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, renderHook, fireEvent } from "@testing-library/react";
import SplitGutter from "~/components/SplitGutter";
import { useSplitDrag } from "~/lib/useSplitDrag";
import { rememberedNumber } from "~/lib/remembered";

/** The divider both editors use: dragging it sets the editor's share of the split. */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SplitGutter", () => {
  it("sets the editor's width from the pointer as it is dragged", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const onPct = vi.fn();
    const box = document.createElement("div");
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ left: 0, width: 1000 } as DOMRect);
    const { result } = renderHook(() => useSplitDrag({ current: box }, onPct));
    const { getByRole } = render(createElement(SplitGutter, { onMouseDown: result.current }));
    fireEvent.mouseDown(getByRole("separator"));
    expect(document.body.classList.contains("mist-dragging")).toBe(true);
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);
    expect(onPct).toHaveBeenLastCalledWith(40);
    expect(document.body.classList.contains("mist-dragging")).toBe(false);
  });

  it("reports pixels from the box's left edge in px mode, for the outline", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const onPx = vi.fn();
    const box = document.createElement("div");
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ left: 100, width: 1000 } as DOMRect);
    const { result } = renderHook(() => useSplitDrag({ current: box }, onPx, "px"));
    const { getByRole } = render(createElement(SplitGutter, { onMouseDown: result.current }));
    fireEvent.mouseDown(getByRole("separator"));
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);
    expect(onPx).toHaveBeenLastCalledWith(300);
  });

  it("shows its children in place of the grip, and a child that stops mousedown starts no drag", () => {
    const onMouseDown = vi.fn();
    const { getByText, container } = render(
      createElement(SplitGutter, { onMouseDown }, createElement("button", { onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation() }, "jump")),
    );
    fireEvent.mouseDown(getByText("jump"));
    expect(onMouseDown).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".rounded-full.bg-ink")).toHaveLength(0);
  });
});

describe("rememberedNumber", () => {
  it("reads a stored width, and the fallback when it is missing or out of range", () => {
    expect(rememberedNumber("k", 20, 80, 50)).toBe(50);
    window.localStorage.setItem("k", "35");
    expect(rememberedNumber("k", 20, 80, 50)).toBe(35);
    window.localStorage.setItem("k", "95");
    expect(rememberedNumber("k", 20, 80, 50)).toBe(50);
  });
});
