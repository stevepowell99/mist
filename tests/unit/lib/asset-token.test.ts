import { describe, it, expect } from "vitest";
import { signAssetToken, verifyAssetToken } from "~/lib/session.server";

const SECRET = "test-secret-asset";

describe("asset token", () => {
  it("round-trips a freshly signed token", async () => {
    const t = await signAssetToken(SECRET);
    expect(await verifyAssetToken(t, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", async () => {
    const t = await signAssetToken(SECRET);
    expect(await verifyAssetToken(t, "other-secret")).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const t = await signAssetToken(SECRET);
    const tampered = "x" + t.slice(1);
    expect(await verifyAssetToken(tampered, SECRET)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const past = Date.now() - 10_000;
    const t = await signAssetToken(SECRET, 1, past); // 1s TTL, signed 10s ago
    expect(await verifyAssetToken(t, SECRET)).toBe(false);
  });

  it("rejects empty input or empty secret", async () => {
    expect(await verifyAssetToken("", SECRET)).toBe(false);
    expect(await verifyAssetToken(await signAssetToken(SECRET), "")).toBe(false);
  });
});
