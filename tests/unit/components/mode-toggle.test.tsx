// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import ModeToggle from "~/components/ModeToggle";

describe("ModeToggle", () => {
  it("shows both Edit and Suggest labels", () => {
    const { getByText } = renderWithDocument(createElement(ModeToggle), {
      context: { mode: "edit" },
    });
    expect(getByText("Edit")).toBeTruthy();
    expect(getByText("Suggest")).toBeTruthy();
  });

  it("emphasizes the active side while keeping both legible", () => {
    const { getByText } = renderWithDocument(createElement(ModeToggle), {
      context: { mode: "suggest" },
    });
    // Both labels stay full-ink (neither looks disabled); the active one is bold.
    expect(getByText("Suggest").className).toContain("text-ink");
    expect(getByText("Edit").className).toContain("text-ink");
    expect(getByText("Suggest").className).toContain("font-semibold");
    expect(getByText("Edit").className).toContain("opacity-60");
  });

  it("toggling calls toggleMode", () => {
    const { contextValue, getByText } = renderWithDocument(
      createElement(ModeToggle),
      { context: { mode: "edit" } },
    );
    fireEvent.click(getByText("Suggest"));
    expect(contextValue.toggleMode).toHaveBeenCalledOnce();
  });

  it("is hidden for suggest-link (non-edit) role", () => {
    const { container } = renderWithDocument(createElement(ModeToggle), {
      context: { role: "suggest" },
    });
    expect(container.firstChild).toBeNull();
  });
});
