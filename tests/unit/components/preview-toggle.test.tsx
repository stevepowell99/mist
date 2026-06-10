// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import PreviewToggle from "~/components/PreviewToggle";

describe("PreviewToggle", () => {
  it("shows both Editor and Preview labels", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: false },
    });
    expect(getByText("Editor")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
  });

  it("emphasizes Preview when preview is showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: true },
    });
    expect(getByText("Preview").className).toContain("text-ink");
  });

  it("emphasizes Editor when preview is not showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: false },
    });
    expect(getByText("Editor").className).toContain("text-ink");
  });

  it("clicking Preview calls togglePreview", () => {
    const { contextValue, getByText } = renderWithDocument(
      createElement(PreviewToggle),
      { context: { showPreview: false } },
    );
    fireEvent.click(getByText("Preview"));
    expect(contextValue.togglePreview).toHaveBeenCalledOnce();
  });
});
