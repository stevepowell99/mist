import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubBackend } from "~/lib/backend.server";
import type { GitHubMeta } from "~/shared/types";

const META: GitHubMeta = { owner: "o", repo: "r", branch: "main", path: "docs/a.md" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubBackend", () => {
  it("read() fetches the raw file and returns text with a null version", async () => {
    const fetchMock = vi.fn(async () => new Response("hello world", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GitHubBackend(META).read();

    expect(result).toEqual({ text: "hello world", version: null });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://raw.githubusercontent.com/o/r/main/docs/a.md");
  });

  it("write() fetches the current sha then PUTs, returning the new sha as version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "oldsha" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { sha: "newsha" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GitHubBackend(META, "tok").write("new text", null, "msg");

    expect(result).toEqual({ version: "newsha" });
    const putInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(putInit.method).toBe("PUT");
    const body = JSON.parse(putInit.body as string) as { message: string; sha: string; branch: string };
    expect(body.message).toBe("msg");
    expect(body.sha).toBe("oldsha");
    expect(body.branch).toBe("main");
  });

  it("write() without a token refuses rather than overwriting", async () => {
    await expect(new GitHubBackend(META).write("x", null, "m")).rejects.toThrow(
      /commit-back not configured/,
    );
  });
});
