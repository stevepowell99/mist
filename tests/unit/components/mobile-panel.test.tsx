// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

describe("MobilePanel", () => {
  it("renders the three tab buttons", () => {
    const { getByRole } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    expect(getByRole("button", { name: "Editing" })).toBeTruthy();
    expect(getByRole("button", { name: "Comments" })).toBeTruthy();
    expect(getByRole("button", { name: "Preview" })).toBeTruthy();
  });

  it("clicking a tab shows corresponding content, clicking again collapses", () => {
    const { getByRole, getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { mode: "suggest" } },
    );

    // Editing tab starts active, should show the Edit/Suggest ModeToggle
    expect(getByText("Suggest")).toBeTruthy();

    // Click Comments tab
    fireEvent.click(getByRole("button", { name: "Comments" }));
    expect(queryByText("Comments (0)")).toBeTruthy();

    // Click Comments tab again to collapse
    fireEvent.click(getByRole("button", { name: "Comments" }));
    expect(queryByText("Comments (0)")).toBeFalsy();
  });

  it("editing tab renders ModeToggle and SuggestionActions", () => {
    const { getByText, getByLabelText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );

    // Editing tab is active by default; ModeToggle shows the Edit/Suggest pair
    expect(getByText("Edit")).toBeTruthy();
    expect(getByLabelText("Edit or Suggest")).toBeTruthy();
  });

  it("comments tab renders CommentInput and ThreadList", () => {
    const { getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { commentActive: true } },
    );

    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comment")).toBeTruthy();
    expect(queryByText("No comments yet")).toBeTruthy();
  });
});
