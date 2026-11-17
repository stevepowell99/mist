import { describe, it, expect, vi } from "vitest";
import { trustedClick } from "~/lib/trusted-click";

describe("trustedClick", () => {
  it("runs for a click a person made", () => {
    const run = vi.fn();
    trustedClick(run)({ isTrusted: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("ignores a synthetic click, as an extension sends", () => {
    const run = vi.fn();
    trustedClick(run)({ isTrusted: false });
    expect(run).not.toHaveBeenCalled();
  });
});
