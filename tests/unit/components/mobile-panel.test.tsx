// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

describe("MobilePanel", () => {
  it("renders the View and Comments tab buttons", () => {
    const { getByRole } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    expect(getByRole("button", { name: "View" })).toBeTruthy();
    expect(getByRole("button", { name: "Comments" })).toBeTruthy();
  });

  it("clicking a tab shows corresponding content, clicking again collapses", () => {
    const { getByRole, getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { mode: "suggest" } },
    );

    // View tab starts active, should show the three-position ViewToggle
    expect(getByText("Suggest")).toBeTruthy();

    // Click Comments tab
    fireEvent.click(getByRole("button", { name: "Comments" }));
    expect(queryByText("Comments (0)")).toBeTruthy();

    // Click Comments tab again to collapse
    fireEvent.click(getByRole("button", { name: "Comments" }));
    expect(queryByText("Comments (0)")).toBeFalsy();
  });

  it("View tab renders the ViewToggle and SuggestionActions", () => {
    const { getByText, getByRole } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );

    // View tab is active by default; ViewToggle shows the three positions
    expect(getByText("Edit")).toBeTruthy();
    expect(getByRole("group", { name: "View mode" })).toBeTruthy();
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
