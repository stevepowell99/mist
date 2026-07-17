import { describe, expect, it } from "vitest";
import {
  idToPath,
  isLocalFileId,
  joinRel,
  nameOf,
  parentPath,
  pathToId,
  trailOf,
} from "~/lib/localfs-ids";
import { parseDriveFileId } from "~/lib/drive-common";

describe("localfs ids", () => {
  it("round-trips paths, including spaces and unicode", () => {
    for (const p of ["", "a.md", "folder/sub folder/note -- draft.md", "décks/über.qmd"]) {
      expect(idToPath(pathToId(p))).toBe(p);
    }
  });

  it("mints ids parseDriveFileId accepts as plain ids", () => {
    const id = pathToId("folder/some file.md");
    expect(parseDriveFileId(id)).toBe(id);
    expect(isLocalFileId(id)).toBe(true);
  });

  it("rejects non-local and unsafe ids", () => {
    expect(idToPath("1AbCrealDriveId")).toBeNull();
    expect(idToPath(pathToId("/etc/passwd"))).toBeNull();
    expect(idToPath(pathToId("a/../b"))).toBeNull();
    expect(idToPath(pathToId("a\\b"))).toBeNull();
  });

  it("derives name, parent and trail", () => {
    expect(nameOf("a/b/c.md")).toBe("c.md");
    expect(parentPath("a/b/c.md")).toBe("a/b");
    expect(parentPath("c.md")).toBe("");
    expect(parentPath("")).toBeNull();
    expect(trailOf("a/b").map((t) => t.name)).toEqual(["a", "b"]);
    expect(idToPath(trailOf("a/b/c.md")[1].id)).toBe("a/b");
    expect(trailOf("")).toEqual([]);
  });

  it("joins relative paths with .. and refuses to escape the root", () => {
    expect(joinRel("a/b", "img/x.png")).toBe("a/b/img/x.png");
    expect(joinRel("a/b", "../css/theme.css")).toBe("a/css/theme.css");
    expect(joinRel("a", "./x.md")).toBe("a/x.md");
    expect(joinRel("", "x.md")).toBe("x.md");
    expect(joinRel("a", "../../x.md")).toBeNull();
  });
});
