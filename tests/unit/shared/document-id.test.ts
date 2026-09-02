import { describe, expect, it } from "vitest";
import {
  documentIdForFile,
  generateDocumentId,
  isValidDocumentId,
} from "~/shared/constants";

describe("documentIdForFile", () => {
  const fileId = "lf_QzpcZGV2XHJ1Ymljb25cZG9jc1xwcmluY2lwbGVzLm1k";

  it("gives the same room for the same file, so one file is never two rooms", () => {
    expect(documentIdForFile(fileId)).toBe(documentIdForFile(fileId));
  });

  it("produces an id the router and the agent both accept", () => {
    expect(isValidDocumentId(documentIdForFile(fileId))).toBe(true);
    expect(isValidDocumentId(documentIdForFile(""))).toBe(true);
  });

  it("separates files that differ only slightly", () => {
    const ids = new Set(
      ["a.md", "b.md", "A.md", "a.mdx", "dir/a.md", "dir\a.md"].map((p) =>
        documentIdForFile(`lf_${p}`),
      ),
    );
    expect(ids.size).toBe(6);
  });

  it("is a different scheme from a random id, but the same shape", () => {
    const random = generateDocumentId();
    expect(random).toHaveLength(documentIdForFile(fileId).length);
  });
});
