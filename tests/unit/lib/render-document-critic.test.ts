// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDocumentHtml } from "~/lib/render-document";

const ctx = { origin: "https://x.test", drive: null, driveToken: null } as never;

describe("document preview: CriticMarkup", () => {
  it("renders a one-line suggestion", () => {
    const html = renderDocumentHtml("Safe to {--delete--}{++ok++}.", ctx);
    expect(html).not.toContain("{++");
  });
  it("renders a suggestion that runs over several lines", () => {
    const html = renderDocumentHtml("Safe.{++ [A1] a0 a1\nB line b0\nC line c0++}\n\nNext para.", ctx);
    expect(html).not.toContain("{++");
    expect(html).not.toContain("++}");
  });
  it("renders a suggestion that starts with a bracketed word", () => {
    const html = renderDocumentHtml("Safe.{++ [A1] a0++} end", ctx);
    expect(html).not.toContain("{++");
  });
});
