// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionList from "~/components/SuggestionList";
import ShareButton from "~/components/ShareButton";
import ConnectionStatus from "~/components/ConnectionStatus";
import Preview from "~/components/Preview";

describe("CleanViewToggle", () => {
  it("renders checkbox reflecting cleanView state", () => {
    const { getByText } = renderWithDocument(createElement(CleanViewToggle), {
      context: { cleanView: true },
    });
    expect(getByText("Show editing markup")).toBeTruthy();
  });

  it("toggle calls toggleCleanView", () => {
    const { contextValue, getByRole } = renderWithDocument(
      createElement(CleanViewToggle),
    );
    fireEvent.click(getByRole("checkbox"));
    expect(contextValue.toggleCleanView).toHaveBeenCalledOnce();
  });
});

describe("SuggestionList", () => {
  it("lists each suggestion with its own accept/reject", () => {
    const { getByText, getAllByText } = renderWithDocument(
      createElement(SuggestionList),
      { context: { markdown: "a {--old--} b {++new++} c", mode: "edit" } },
    );
    expect(getByText("Delete")).toBeTruthy();
    expect(getByText("Insert")).toBeTruthy();
    expect(getAllByText("Accept")).toHaveLength(2);
    expect(getByText("Accept all")).toBeTruthy();
    expect(getByText("Reject all")).toBeTruthy();
  });

  it("prompts in suggest mode when there is nothing to review", () => {
    const { queryByText } = renderWithDocument(
      createElement(SuggestionList),
      { context: { markdown: "plain text", mode: "suggest" } },
    );
    expect(queryByText("Accept all")).toBeNull();
  });
});

describe("ShareButton", () => {
  it("renders share trigger button", () => {
    const { getByLabelText } = renderWithDocument(createElement(ShareButton));
    expect(getByLabelText("Share options")).toBeTruthy();
  });
});

describe("ConnectionStatus", () => {
  it("renders a status dot with an accessible label", () => {
    const { getByLabelText } = renderWithDocument(createElement(ConnectionStatus));
    expect(getByLabelText("Connection: Connecting")).toBeTruthy();
  });
});

describe("Preview", () => {
  it("renders markdown as HTML", () => {
    const { container } = renderWithDocument(createElement(Preview), {
      context: { markdown: "Hello world" },
    });
    expect(container.querySelector(".preview")).toBeTruthy();
  });
});
