/**
 * Local-filesystem storage implementation (server-only): the same function
 * surface as google-drive.server.ts, backed by this machine's files via the
 * localfs sidecar (scripts/localfs-server.mjs). The Worker runs in workerd,
 * which cannot touch the host disk, so every operation is an HTTP call to the
 * sidecar on 127.0.0.1, authenticated with a shared token. Dev-only: enabled
 * by LOCAL_FS_URL in .dev.vars, dispatched by the google.server.ts facade, and
 * never active on the deployed worker.
 *
 * Ids are the file's absolute path, base64url-encoded (see localfs-ids.ts), so
 * files on any drive (C:, G:, H:) are reachable. All path arithmetic belongs to
 * the sidecar, which has node's `path`; this module passes opaque ids and never
 * splits a path itself.
 *
 * The version token is a content hash, which is the project's "content is the
 * source of truth" principle made literal: a re-save of identical bytes keeps
 * the same version, so the conflict machinery only fires on a genuine change.
 * Permissions are a constant anyone/writer grant: the local user owns their own
 * disk, and sign-in is bypassed in local mode.
 *
 * There is NO search: TagFox is the way into a local file (see resolveLocalPath
 * and the /open?path= route). Only folder LISTING is supported, which the doc
 * sidebar and the library gallery need, and which is a plain readdir.
 */
import {
  driveKind,
  type DriveEntry,
  type DriveFileDetails,
  type DriveFileMeta,
  type DriveGrant,
  type DriveKind,
  type DriveSearchEntry,
} from "./drive-common";
import { idToPath, pathToId } from "./localfs-ids";
import { mimeForPath } from "./mime";

/** Token minted by the facade in local mode: the sidecar base URL and shared
 *  token behind a prefix, so every (token, ...) signature carries its own
 *  dispatch context and credential. */
export const LOCAL_TOKEN_PREFIX = "localfs:";

export function isLocalToken(token: string): boolean {
  return token.startsWith(LOCAL_TOKEN_PREFIX);
}

/** Pack/unpack the sidecar URL and its shared token into one opaque string. */
export function packLocalToken(url: string, secret: string): string {
  return `${LOCAL_TOKEN_PREFIX}${secret}@${url}`;
}

function unpack(token: string): { base: string; secret: string } {
  const rest = token.slice(LOCAL_TOKEN_PREFIX.length);
  const at = rest.indexOf("@");
  return { secret: rest.slice(0, at), base: rest.slice(at + 1).replace(/\/$/, "") };
}

/** Decode an id or fail like Drive fails on an unknown file. */
function pathOf(id: string): string {
  const p = idToPath(id);
  if (p === null) throw new Error("local file not found (not a local file id)");
  return p;
}

async function call<T>(token: string, pathAndQuery: string, init?: RequestInit): Promise<T> {
  const { base, secret } = unpack(token);
  const res = await fetch(base + pathAndQuery, {
    ...init,
    headers: { ...(init?.headers ?? {}), "X-Localfs-Token": secret },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `local fs error (${res.status})`);
  return body;
}

function q(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  return "?" + sp.toString();
}

interface Stat {
  exists: boolean;
  isFolder: boolean;
  name: string;
  parent: string | null;
  trail: { path: string; name: string }[];
  mtimeMs: number;
  size: number;
  version: string | null;
}

function kindForLocal(name: string, isFolder: boolean): DriveKind {
  return isFolder ? "folder" : driveKind(mimeForPath(name), name);
}

/**
 * An absolute path on this machine to a file identity, for an external tool
 * (TagFox) handing a file over by path rather than by id. Returns null when the
 * sidecar refuses it (missing, a folder, or not .md/.qmd). The id scheme stays
 * gmist's business: callers pass a path and get back an id.
 */
export async function resolveLocalPath(
  token: string,
  absPath: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const r = await call<{ path: string; name: string }>(token, "/resolve" + q({ abs: absPath }));
    return { id: pathToId(r.path), name: r.name };
  } catch {
    return null;
  }
}

export async function driveGetMeta(token: string, fileId: string): Promise<DriveFileMeta> {
  const stat = await call<Stat>(token, "/stat" + q({ path: pathOf(fileId) }));
  if (!stat.exists) throw new Error("local file not found");
  return {
    id: fileId,
    name: stat.name,
    parents: stat.parent ? [pathToId(stat.parent)] : undefined,
    version: stat.version,
  };
}

export async function driveFileDetails(token: string, fileId: string): Promise<DriveFileDetails> {
  const stat = await call<Stat>(token, "/stat" + q({ path: pathOf(fileId) }));
  if (!stat.exists) throw new Error("local file not found");
  return {
    id: fileId,
    name: stat.name,
    modifiedTime: new Date(stat.mtimeMs).toISOString(),
    size: stat.size,
    owners: [{ name: "Local file" }],
    lastModifiedBy: null,
    webViewLink: null,
  };
}

export async function driveRead(token: string, fileId: string): Promise<{ text: string; version: string | null }> {
  return call<{ text: string; version: string | null }>(token, "/read" + q({ path: pathOf(fileId) }));
}

export async function driveWrite(
  token: string,
  fileId: string,
  content: string,
): Promise<{ version: string | null }> {
  return call<{ version: string | null }>(token, "/write" + q({ path: pathOf(fileId) }), {
    method: "POST",
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: content,
  });
}

export async function driveListFolder(token: string, folderId: string): Promise<DriveEntry[]> {
  const folder = idToPath(folderId);
  // A non-local id here (e.g. the Drive library folder default) is simply a
  // folder that does not exist locally: empty, not an error.
  if (folder === null) return [];
  const { entries } = await call<{ entries: { path: string; name: string; isFolder: boolean }[] }>(
    token,
    "/list" + q({ path: folder }),
  );
  return entries.map((e) => ({ id: pathToId(e.path), name: e.name, isFolder: e.isFolder }));
}

export async function driveResolvePath(
  token: string,
  folderId: string,
  relPath: string,
): Promise<string | null> {
  const r = await call<{ path: string }>(
    token,
    "/resolve-rel" + q({ base: pathOf(folderId), rel: relPath }),
  );
  return pathToId(r.path);
}

export async function driveTrail(token: string, folderId: string): Promise<{ id: string; name: string }[]> {
  const folder = idToPath(folderId);
  if (folder === null) return [];
  const stat = await call<Stat>(token, "/stat" + q({ path: folder }));
  return stat.trail.map((t) => ({ id: pathToId(t.path), name: t.name }));
}

export async function driveCreateFile(
  token: string,
  folderId: string,
  name: string,
  content = "",
): Promise<{ id: string; name: string }> {
  const target = childPath(pathOf(folderId), name);
  await call<{ version: string | null }>(token, "/write" + q({ path: target }), {
    method: "POST",
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: content,
  });
  return { id: pathToId(target), name };
}

/** Where a new `name` lands inside a folder. A file being created does not yet
 *  exist, so the sidecar cannot stat it; this is the one bit of path joining the
 *  worker does, and it only appends a segment (the hard splitting stays server-
 *  side). Uses the folder's own separator so a Windows path stays Windows. */
function childPath(folder: string, name: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

export async function driveCreateBinary(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<{ id: string; name: string }> {
  const target = childPath(pathOf(folderId), name);
  await call<{ version: string | null }>(token, "/write" + q({ path: target }), {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  return { id: pathToId(target), name };
}

export async function driveEnsureSubfolder(token: string, parentId: string, name: string): Promise<string> {
  const target = childPath(pathOf(parentId), name);
  await call<{ ok: boolean }>(token, "/mkdir" + q({ path: target }), { method: "POST" });
  return pathToId(target);
}

/** Rename changes the path and therefore the id; an open room bound to the old
 *  id will stop resolving until the file is reopened. Documented limitation. */
export async function driveRename(token: string, fileId: string, name: string): Promise<void> {
  await call<{ path: string }>(token, "/rename" + q({ path: pathOf(fileId), name }), { method: "POST" });
}

export async function driveCopy(
  token: string,
  fileId: string,
  name?: string,
): Promise<{ id: string; name: string }> {
  const r = await call<{ path: string; name: string }>(
    token,
    "/copy" + q({ path: pathOf(fileId), name }),
    { method: "POST" },
  );
  return { id: pathToId(r.path), name: r.name };
}

export async function driveTrash(token: string, fileId: string): Promise<void> {
  await call<{ ok: boolean }>(token, "/trash" + q({ path: pathOf(fileId) }), { method: "POST" });
}

export async function driveDownload(token: string, fileId: string): Promise<ArrayBuffer> {
  const { base, secret } = unpack(token);
  const res = await fetch(base + "/raw" + q({ path: pathOf(fileId) }), {
    headers: { "X-Localfs-Token": secret },
  });
  if (!res.ok) throw new Error(`local read failed (${res.status})`);
  return res.arrayBuffer();
}

function toSearchEntry(e: { path: string; name: string; isFolder: boolean }, parentId: string, trail: { id: string; name: string }[]): DriveSearchEntry {
  return {
    id: pathToId(e.path),
    name: e.name,
    kind: kindForLocal(e.name, e.isFolder),
    webViewLink: null,
    path: trail.map((t) => t.name).join(" / "),
    parentId,
    trail,
  };
}

/**
 * Folder LISTING only (the library gallery browsing a folder, and any other
 * folder-scoped list). A name or full-text QUERY is not supported in local
 * mode and returns []: there is no index, by design, because walking the
 * machine would be pointless when TagFox already indexes it. The search route
 * tells the user so rather than showing an empty list.
 */
export async function driveFiles(
  token: string,
  opts: { nameQuery?: string; folderId?: string; types?: DriveKind[]; fullText?: boolean; limit?: number },
): Promise<DriveSearchEntry[]> {
  if (!opts.folderId || opts.nameQuery) return [];
  const folder = pathOf(opts.folderId);
  const [{ entries }, trail] = await Promise.all([
    call<{ entries: { path: string; name: string; isFolder: boolean }[] }>(token, "/list" + q({ path: folder })),
    driveTrail(token, opts.folderId),
  ]);
  const wanted = opts.types && opts.types.length ? new Set(opts.types) : null;
  return entries
    .map((e) => toSearchEntry(e, opts.folderId!, trail))
    .filter((e) => !wanted || wanted.has(e.kind))
    .slice(0, opts.limit ?? 1000);
}

/** Parent-folder expansion exists to widen a name SEARCH, which local mode does
 *  not have, so there is nothing to widen. */
export async function driveFilesUnderFolders(
  _token: string,
  _folderIds: string[],
  _types: DriveKind[],
  _limit = 60,
): Promise<DriveSearchEntry[]> {
  return [];
}

/** Local files are the user's own disk: one constant anyone/writer grant, so
 *  every ACL check passes with edit and no sidecar call is needed. */
export async function driveListPermissions(_token: string, _fileId: string): Promise<DriveGrant[]> {
  return [{ type: "anyone", role: "writer" }];
}
