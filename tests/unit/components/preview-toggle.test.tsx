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

  it("colours Preview green and bolds it when showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: true },
    });
    expect(getByText("Preview").className).toContain("text-signal-green");
    expect(getByText("Editor").className).toContain("text-signal-red");
    expect(getByText("Preview").className).toContain("font-semibold");
    expect(getByText("Editor").className).toContain("opacity-50");
  });

  it("bolds Editor when preview is not showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: false },
    });
    expect(getByText("Editor").className).toContain("font-semibold");
    expect(getByText("Preview").className).toContain("opacity-50");
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
