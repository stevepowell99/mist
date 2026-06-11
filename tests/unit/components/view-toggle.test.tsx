// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import ViewToggle from "~/components/ViewToggle";

describe("ViewToggle", () => {
  it("shows all three positions for edit-role users", () => {
    const { getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { role: "edit", mode: "edit", showPreview: false },
    });
    expect(getByText("Edit")).toBeTruthy();
    expect(getByText("Suggest")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
  });

  it("hides Edit for suggest-link users", () => {
    const { queryByText, getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { role: "suggest", mode: "suggest", showPreview: false },
    });
    expect(queryByText("Edit")).toBeNull();
    expect(getByText("Suggest")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
  });

  it("marks the current position pressed and colours it", () => {
    const { getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { mode: "suggest", showPreview: false },
    });
    expect(getByText("Suggest").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("Suggest").className).toContain("bg-signal-orange");
    expect(getByText("Edit").getAttribute("aria-pressed")).toBe("false");
    expect(getByText("Edit").className).toContain("text-signal-red");
  });

  it("treats Preview as the active position regardless of mode", () => {
    const { getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { mode: "edit", showPreview: true },
    });
    expect(getByText("Preview").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("Edit").getAttribute("aria-pressed")).toBe("false");
  });

  it("selecting Preview turns preview on", () => {
    const { contextValue, getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { mode: "edit", showPreview: false },
    });
    fireEvent.click(getByText("Preview"));
    expect(contextValue.setPreview).toHaveBeenCalledWith(true);
  });

  it("selecting Suggest from Edit leaves preview and toggles mode", () => {
    const { contextValue, getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { mode: "edit", showPreview: false },
    });
    fireEvent.click(getByText("Suggest"));
    expect(contextValue.setPreview).toHaveBeenCalledWith(false);
    expect(contextValue.toggleMode).toHaveBeenCalledOnce();
  });

  it("selecting the mode you are already in does not toggle", () => {
    const { contextValue, getByText } = renderWithDocument(createElement(ViewToggle), {
      context: { mode: "edit", showPreview: false },
    });
    fireEvent.click(getByText("Edit"));
    expect(contextValue.setPreview).toHaveBeenCalledWith(false);
    expect(contextValue.toggleMode).not.toHaveBeenCalled();
  });
});
