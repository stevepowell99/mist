import { describe, it, expect } from "vitest";
import {
  parseGitHubFileUrl,
  dirOf,
  resolveAssetPath,
  rawAssetUrl,
  rewriteImageUrls,
  resolveImageSrc,
} from "~/lib/github";

describe("parseGitHubFileUrl", () => {
  it("parses a blob URL", () => {
    expect(
      parseGitHubFileUrl("https://github.com/me/repo/blob/main/docs/report.md"),
    ).toEqual({ owner: "me", repo: "repo", branch: "main", path: "docs/report.md" });
  });

  it("parses a raw URL", () => {
    expect(
      parseGitHubFileUrl("https://raw.githubusercontent.com/me/repo/main/a/b.md"),
    ).toEqual({ owner: "me", repo: "repo", branch: "main", path: "a/b.md" });
  });

  it("rejects non-GitHub URLs", () => {
    expect(parseGitHubFileUrl("https://example.com/x/y/blob/main/a.md")).toBeNull();
  });

  it("rejects a repo root URL with no file path", () => {
    expect(parseGitHubFileUrl("https://github.com/me/repo")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseGitHubFileUrl("not a url")).toBeNull();
  });
});

describe("resolveAssetPath", () => {
  it("resolves a sibling image against the doc directory", () => {
    expect(resolveAssetPath("docs/report.md", "images/fig.png")).toBe("docs/images/fig.png");
  });

  it("handles parent traversal", () => {
    expect(resolveAssetPath("docs/sub/report.md", "../assets/x.png")).toBe("docs/assets/x.png");
  });

  it("handles a root-level doc", () => {
    expect(resolveAssetPath("report.md", "fig.png")).toBe("fig.png");
  });
});

describe("dirOf", () => {
  it("returns the directory", () => {
    expect(dirOf("a/b/c.md")).toBe("a/b");
  });
  it("returns empty for a top-level file", () => {
    expect(dirOf("c.md")).toBe("");
  });
});

describe("rawAssetUrl", () => {
  it("builds an encoded raw URL", () => {
    expect(
      rawAssetUrl({ owner: "me", repo: "r", branch: "main" }, "docs/a b.png"),
    ).toBe("https://raw.githubusercontent.com/me/r/main/docs/a%20b.png");
  });
});

describe("rewriteImageUrls", () => {
  const gh = { owner: "me", repo: "r", branch: "main", path: "docs/report.md" };

  it("rewrites a relative image to a raw URL", () => {
    const out = rewriteImageUrls("![fig](images/a.png)", gh);
    expect(out).toBe("![fig](https://raw.githubusercontent.com/me/r/main/docs/images/a.png)");
  });

  it("leaves absolute image URLs untouched", () => {
    const md = "![x](https://cdn.example.com/a.png)";
    expect(rewriteImageUrls(md, gh)).toBe(md);
  });

  it("leaves plain links untouched", () => {
    const md = "[text](other.md)";
    expect(rewriteImageUrls(md, gh)).toBe(md);
  });

  it("rewrites a relative HTML img src", () => {
    const out = rewriteImageUrls('<img width="500" src="media/logo.svg" alt="x">', gh);
    expect(out).toBe(
      '<img width="500" src="https://raw.githubusercontent.com/me/r/main/docs/media/logo.svg" alt="x">',
    );
  });

  it("leaves absolute HTML img src untouched", () => {
    const md = '<img src="https://cdn.example.com/a.png">';
    expect(rewriteImageUrls(md, gh)).toBe(md);
  });
});

describe("resolveImageSrc", () => {
  const gh = { owner: "me", repo: "r", branch: "main", path: "docs/report.md" };

  it("passes through absolute http URLs", () => {
    expect(resolveImageSrc("https://x.com/a.png", gh)).toBe("https://x.com/a.png");
  });

  it("passes through data URLs", () => {
    expect(resolveImageSrc("data:image/png;base64,AAAA", gh)).toBe("data:image/png;base64,AAAA");
  });

  it("resolves a relative path against the doc directory", () => {
    expect(resolveImageSrc(".assets/x.png", gh)).toBe(
      "https://raw.githubusercontent.com/me/r/main/docs/.assets/x.png",
    );
  });

  it("returns null for a relative path with no github metadata", () => {
    expect(resolveImageSrc("images/a.png", null)).toBeNull();
  });

  it("returns null for an anchor", () => {
    expect(resolveImageSrc("#frag", gh)).toBeNull();
  });
});
