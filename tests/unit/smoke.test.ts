import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  isValidDocumentId,
} from "~/shared/constants";

describe("scaffolding", () => {
  it("exports app name", () => {
    expect(APP_NAME).toBe("gmist");
  });
});

describe("isValidDocumentId", () => {
  it("accepts valid 8-char lowercase alphanumeric IDs", () => {
    expect(isValidDocumentId("abcd1234")).toBe(true);
  });

  it("rejects IDs that are too short", () => {
    expect(isValidDocumentId("abc")).toBe(false);
  });

  it("rejects IDs with uppercase letters", () => {
    expect(isValidDocumentId("ABCD1234")).toBe(false);
  });
});
