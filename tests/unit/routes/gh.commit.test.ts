import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockCommitFile } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockCommitFile: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

let env: Record<string, unknown>;
vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn(() => ({ env })),
}));

vi.mock("~/lib/github.server", () => ({
  commitFile: mockCommitFile,
}));

import { action } from "~/routes/gh.commit";

const context = {} as Parameters<typeof action>[0]["context"];

function post(body: unknown) {
  return new Request("https://mist.example.com/gh/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const github = { owner: "me", repo: "r", branch: "main", path: "doc.md" };

describe("POST /gh/commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env = { DocumentAgent: {}, GITHUB_TOKEN: "tok", ADMIN_KEY: "secret" };
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ role: "edit", github }), { status: 200 }),
    );
    mockCommitFile.mockResolvedValue({ sha: "newsha" });
  });

  it("commits when admin key, edit role, and github metadata are present", async () => {
    const res = await action({
      request: post({ docId: "abcd1234", key: "ek", adminKey: "secret", content: "# Hi" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockCommitFile).toHaveBeenCalledOnce();
  });

  it("rejects a wrong admin key", async () => {
    const res = await action({
      request: post({ docId: "abcd1234", key: "ek", adminKey: "nope", content: "x" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(403);
    expect(mockCommitFile).not.toHaveBeenCalled();
  });

  it("returns 501 when no token is configured", async () => {
    env = { DocumentAgent: {}, ADMIN_KEY: "secret" };
    const res = await action({
      request: post({ docId: "abcd1234", key: "ek", adminKey: "secret", content: "x" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(501);
  });

  it("refuses a suggest-role caller", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ role: "suggest", github }), { status: 200 }),
    );
    const res = await action({
      request: post({ docId: "abcd1234", key: "sk", adminKey: "secret", content: "x" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(403);
    expect(mockCommitFile).not.toHaveBeenCalled();
  });

  it("refuses a doc with no github metadata", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ role: "edit", github: null }), { status: 200 }),
    );
    const res = await action({
      request: post({ docId: "abcd1234", key: "ek", adminKey: "secret", content: "x" }),
      context,
    } as Parameters<typeof action>[0]);
    expect(res.status).toBe(400);
  });
});
