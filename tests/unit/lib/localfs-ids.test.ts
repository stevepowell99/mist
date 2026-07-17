import { describe, expect, it } from "vitest";
import { idToPath, isLocalFileId, pathToId } from "~/lib/localfs-ids";
import { parseDriveFileId } from "~/lib/drive-common";

describe("localfs ids", () => {
  it("round-trips absolute paths across drives, spaces and unicode", () => {
    for (const p of [
      "C:\\Users\\Zoom\\note.md",
      "H:\\Shared drives\\Causal-Map-Management\\a doc.md",
      "G:\\My Drive\\décks\\über -- draft.qmd",
      "/home/steve/vault/note.md",
    ]) {
      expect(idToPath(pathToId(p))).toBe(p);
    }
  });

  it("mints ids parseDriveFileId accepts as plain ids", () => {
    const id = pathToId("C:\\Users\\Zoom\\some file.md");
    expect(parseDriveFileId(id)).toBe(id);
    expect(isLocalFileId(id)).toBe(true);
  });

  it("treats a real Drive id as not-a-local-file", () => {
    expect(idToPath("1AbCrealDriveId")).toBeNull();
    expect(isLocalFileId("1AbCrealDriveId")).toBe(false);
  });

  it("rejects an id whose payload contains a NUL", () => {
    expect(idToPath(pathToId("C:\\x\0y.md"))).toBeNull();
  });
});
