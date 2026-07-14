import { describe, it, expect } from "vitest";
import { rewriteImages } from "~/lib/asset-urls";

const ctx = {
  drive: { fileId: "F1", folderId: "D1", name: "doc.md" } as never,
  origin: "https://x.dev",
  driveToken: "T",
};

describe("rewriteImages", () => {
  it("resolves a plain relative image", () => {
    expect(rewriteImages("![a](img/x.png)", ctx)).toContain("/drive/asset?deck=F1&path=img/x.png&token=T");
  });

  it("resolves an angle-bracket path (the only way to write spaces)", () => {
    // The old pattern demanded a space-free src, so these stayed relative and 404ed.
    const out = rewriteImages("![a](<../600 How to/img/y.png>)", ctx);
    expect(out).toContain("path=../600%20How%20to/img/y.png");
  });

  it("renders an Obsidian image embed, which used to come out as plain text", () => {
    const out = rewriteImages("![[001 Papers/img/z.jpg]]", ctx);
    expect(out).toContain("![](");
    expect(out).toContain("path=001%20Papers/img/z.jpg");
  });

  it("keeps an embed alias as the alt text, and leaves a note embed alone", () => {
    expect(rewriteImages("![[img/z.jpg|a caption]]", ctx)).toContain("![a caption](");
    expect(rewriteImages("![[Some note]]", ctx)).toBe("![[Some note]]");
  });

  it("leaves absolute URLs untouched", () => {
    expect(rewriteImages("![a](https://e.com/i.png)", ctx)).toBe("![a](https://e.com/i.png)");
  });
});
