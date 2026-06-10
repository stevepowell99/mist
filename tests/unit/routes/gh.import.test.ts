import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockFetch } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { DocumentAgent: {} } }),
}));

vi.mock("~/shared/constants", async () => {
  const actual = await vi.importActual<typeof import("~/shared/constants")>("~/shared/constants");
  return { ...actual, generateDocumentId: vi.fn().mockReturnValue("abcd1234") };
});

import { action } from "~/routes/gh.import";

const context = {} as Parameters<typeof action>[0]["context"];

function post(body: unknown) {
  return new Request("https://mist.example.com/gh/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /gh/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, editKey: "ek" }), { status: 200 }),
    );
  });

  it("imports a public markdown file and returns the edit link", async () => {
    mockFetch.mockResolvedValue(new Response("# Hello", { status: 200 }));
    const res = await action({
      request: post({ url: "https://github.com/me/repo/blob/main/doc.md" }),
      context,
    } as Parameters<typeof action>[0]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("/docs/abcd1234?k=ek");

    // The raw file was fetched and the agent got the github metadata
    expect(mockFetch).toHaveBeenCalledOnce();
    const agentReq = mockAgentFetch.mock.calls[0][0] as Request;
    const agentBody = await agentReq.json();
    expect(agentBody.github).toEqual({ owner: "me", repo: "repo", branch: "main", path: "doc.md" });
  });

  it("rejects a non-GitHub URL", async () => {
    const res = await action({
      request: post({ url: "https://example.com/x.md" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-markdown path", async () => {
    const res = await action({
      request: post({ url: "https://github.com/me/repo/blob/main/img.png" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(400);
  });

  it("returns 502 when the file cannot be fetched", async () => {
    mockFetch.mockResolvedValue(new Response("nope", { status: 404 }));
    const res = await action({
      request: post({ url: "https://github.com/me/repo/blob/main/doc.md" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(502);
  });
});
