import { describe, expect, it } from "vitest";
import { shouldOfferRatherThanTake } from "~/lib/outside-change";

const base = { dirty: false, reverted: false, currentLength: 55856, incomingLength: 55856 };

describe("shouldOfferRatherThanTake", () => {
  it("follows the file when somebody else has simply edited it", () => {
    expect(shouldOfferRatherThanTake({ ...base, incomingLength: 56200 })).toBe(false);
    expect(shouldOfferRatherThanTake({ ...base, incomingLength: 55800 })).toBe(false);
  });

  it("never swallows edits made here", () => {
    expect(shouldOfferRatherThanTake({ ...base, dirty: true })).toBe(true);
  });

  it("never swallows a revert to a version we have already been at", () => {
    expect(shouldOfferRatherThanTake({ ...base, reverted: true, incomingLength: 55856 })).toBe(true);
  });

  it("catches the loss that prompted it: 765 characters of 55,856", () => {
    expect(shouldOfferRatherThanTake({ ...base, incomingLength: 55856 - 765 })).toBe(true);
  });

  it("does not fire on a trivial shortening", () => {
    expect(shouldOfferRatherThanTake({ ...base, incomingLength: 55856 - 150 })).toBe(false);
  });

  it("holds for a small document, where a percentage rule alone would not", () => {
    expect(shouldOfferRatherThanTake({ ...base, currentLength: 900, incomingLength: 650 })).toBe(true);
  });

  it("takes the change when the incoming length is not known yet", () => {
    expect(shouldOfferRatherThanTake({ ...base, incomingLength: null })).toBe(false);
  });
});
