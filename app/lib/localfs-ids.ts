/**
 * Local-fs file ids: a file's "Drive id" is `lf_` + base64url of its ABSOLUTE
 * path. Deterministic and reversible, so an id is minted from a path with no
 * lookup and decodes for debugging, and it spans drive letters (C:, G:, H:)
 * rather than being trapped under one root. The alphabet (A-Za-z0-9_-) matches
 * parseDriveFileId's plain-id pattern.
 *
 * There is no path arithmetic here on purpose: Windows path semantics are the
 * sidecar's job (it has node's `path`), so the worker only ever passes opaque
 * ids around. See scripts/localfs-server.mjs.
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

/** Id for an absolute path. */
export function pathToId(absPath: string): string {
  return LOCAL_ID_PREFIX + b64urlEncode(absPath);
}

/**
 * Decode an id back to its absolute path, or null when the id is not a local
 * id or does not decode to one. A real Drive id (e.g. the library folder
 * default) is simply "not a local file".
 */
export function idToPath(id: string): string | null {
  if (!isLocalFileId(id)) return null;
  let p: string;
  try {
    p = b64urlDecode(id.slice(LOCAL_ID_PREFIX.length));
  } catch {
    return null;
  }
  return p && !p.includes("\0") ? p : null;
}
