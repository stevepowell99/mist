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

  it("folderRef() is the directory holding the document", () => {
    expect(new GitHubBackend(META).folderRef()).toBe("docs");
    expect(new GitHubBackend({ ...META, path: "top.md" }).folderRef()).toBe("");
  });

  it("parentRef() climbs to the repo root then stops", () => {
    const b = new GitHubBackend(META);
    expect(b.parentRef("docs/sub")).toBe("docs");
    expect(b.parentRef("docs")).toBe("");
    expect(b.parentRef("")).toBeNull();
  });

  it("list() returns folders first then .md/.qmd files, skipping other files", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { name: "b.md", path: "docs/b.md", type: "file" },
          { name: "notes.txt", path: "docs/notes.txt", type: "file" },
          { name: "deck.qmd", path: "docs/deck.qmd", type: "file" },
          { name: "a.md", path: "docs/a.md", type: "file" },
          { name: "img", path: "docs/img", type: "dir" },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const entries = await new GitHubBackend(META).list();

    expect(entries).toEqual([
      { name: "img", isFolder: true, ref: "docs/img" },
      { name: "a.md", isFolder: false, ref: "docs/a.md" },
      { name: "b.md", isFolder: false, ref: "docs/b.md" },
      { name: "deck.qmd", isFolder: false, ref: "docs/deck.qmd" },
    ]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/docs?ref=main");
  });

  it("list(folderRef) lists the requested folder, not the document's", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new GitHubBackend(META).list("docs/sub");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/docs/sub?ref=main");
  });
});
