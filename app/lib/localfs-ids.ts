/**
 * Local-fs file ids: pure path/id helpers, shared by google-localfs.server.ts
 * and its tests. A local file's "Drive id" is `lf_` + base64url(relative path,
 * "/"-separated, "" for the root folder). Deterministic and reversible, so an
 * id can be minted from a path with no lookup, and decoded for debugging.
 * The alphabet (A-Za-z0-9_-) matches parseDriveFileId's plain-id pattern.
 */

export const LOCAL_ID_PREFIX = "lf_";

export function isLocalFileId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Id for a root-relative path ("" = the root folder itself). */
export function pathToId(relPath: string): string {
  return LOCAL_ID_PREFIX + b64urlEncode(relPath);
}

/**
 * Decode an id back to its relative path, or null when the id is not a local
 * id or decodes to something unsafe (absolute, backslashes, `..`). A real
 * Drive id (e.g. the library folder default) is simply "not a local file".
 */
export function idToPath(id: string): string | null {
  if (!isLocalFileId(id)) return null;
  let path: string;
  try {
    path = b64urlDecode(id.slice(LOCAL_ID_PREFIX.length));
  } catch {
    return null;
  }
  if (path === "") return "";
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  const segs = path.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  return path;
}

/** The last path segment (the file or folder name); the root has none. */
export function nameOf(relPath: string): string {
  if (relPath === "") return "";
  const segs = relPath.split("/");
  return segs[segs.length - 1];
}

/** The parent folder path, "" for a top-level entry, null for the root itself. */
export function parentPath(relPath: string): string | null {
  if (relPath === "") return null;
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
}

/** Folder trail top -> the given path inclusive, each segment id + name.
 *  The root itself contributes no entry (like Drive dropping "My Drive"). */
export function trailOf(relPath: string): { id: string; name: string }[] {
  if (relPath === "") return [];
  const segs = relPath.split("/");
  return segs.map((name, i) => ({ id: pathToId(segs.slice(0, i + 1).join("/")), name }));
}

/**
 * Join a relative path onto a base folder path, resolving `.` and `..`.
 * Returns null when `..` would escape the root (parity with the Drive
 * implementation returning null past the shared root).
 */
export function joinRel(basePath: string, relPath: string): string | null {
  const out = basePath === "" ? [] : basePath.split("/");
  for (const seg of relPath.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}
