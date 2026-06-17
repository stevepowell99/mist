// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

/**
 * The edit/suggest/preview control now lives in the main header at every width,
 * so MobilePanel is just the comments/suggestion surface: one toggle that opens
 * the comment panel. (It used to carry a second copy of the ViewToggle.)
 */
describe("MobilePanel", () => {
  it("renders a Comments toggle, collapsed by default", () => {
    const { getByRole, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    expect(getByRole("button", { name: "Comments" })).toBeTruthy();
    expect(queryByText("No comments yet")).toBeFalsy();
  });

  it("opens on tap to show the comment surface, then Close collapses it", () => {
    const { getByRole, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    fireEvent.click(getByRole("button", { name: "Comments" }));
    expect(queryByText("No comments yet")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Close" }));
    expect(queryByText("No comments yet")).toBeFalsy();
  });
});
