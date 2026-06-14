import { describe, it, expect } from "vitest";
import { action } from "~/routes/gh.import";

function post(body: unknown) {
  return new Request("https://mist.example.com/gh/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// GitHub import is disabled (14 June 2026) so mist does not double-sync files
// that live in both git and Drive. The route returns 410.
describe("POST /gh/import (disabled)", () => {
  it("returns 410 with a disabled message", async () => {
    const res = await action({
      request: post({ url: "https://github.com/me/repo/blob/main/doc.md" }),
      context: {} as Parameters<typeof action>[0]["context"],
    } as Parameters<typeof action>[0]);

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/disabled/i);
  });

  it("rejects non-POST methods", async () => {
    const res = await action({
      request: new Request("https://mist.example.com/gh/import", { method: "GET" }),
      context: {} as Parameters<typeof action>[0]["context"],
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(405);
  });
});
