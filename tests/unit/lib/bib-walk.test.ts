import { describe, it, expect, vi } from "vitest";

// A folder tree: the document sits in `doc`; `vault` has a hand-kept bib under
// `assets/`; the main library is two levels further up in `root`.
const TREE: Record<string, { parent?: string; entries: { id: string; name: string; isFolder: boolean }[] }> = {
  doc: { parent: "vault", entries: [{ id: "note", name: "note.md", isFolder: false }] },
  vault: { parent: "site", entries: [{ id: "assets", name: "assets", isFolder: true }] },
  assets: { parent: "vault", entries: [{ id: "extra", name: "extra-refs.bib", isFolder: false }] },
  site: { parent: "root", entries: [] },
  root: { entries: [{ id: "main", name: "MyLibrary.bib", isFolder: false }] },
};
const FILES: Record<string, string> = {
  extra: "@misc{shared, title={Near copy}, year={2001}}\n@misc{onlyNear, title={Only near}, year={2002}}\n",
  main: "@misc{shared, title={Far copy}, year={1999}}\n@misc{onlyFar, title={Only far}, year={2003}}\n",
};

vi.mock("~/lib/google.server", () => ({
  isLocalMode: () => false,
  driveListFolder: async (_t: string, id: string) => TREE[id]?.entries ?? [],
  driveGetMeta: async (_t: string, id: string) => ({ id, name: id, parents: TREE[id]?.parent ? [TREE[id].parent] : [] }),
  driveDownload: async (_t: string, id: string) => new TextEncoder().encode(FILES[id] ?? ""),
  driveResolvePath: async () => {
    throw new Error("not found");
  },
}));

const { findBibText } = await import("~/lib/bib.server");
const { parseBib } = await import("~/lib/citations");

describe("findBibText folder walk", () => {
  it("merges every bib on the way up, so a nearby extra bib does not hide the main library", async () => {
    const lib = parseBib(await findBibText({} as Env, "t", "doc", []));
    expect([...lib.keys()].sort()).toEqual(["onlyFar", "onlyNear", "shared"]);
  });

  it("lets the nearest copy of a key win", async () => {
    const lib = parseBib(await findBibText({} as Env, "t", "doc", []));
    expect(lib.get("shared")?.title).toBe("Near copy");
  });

  it("finds a library further up, and returns empty text when there is none", async () => {
    expect(await findBibText({} as Env, "t", "site", [])).toContain("Only far");
    TREE.root.entries = [];
    expect(await findBibText({} as Env, "t", "site", [])).toBe("");
  });
});
