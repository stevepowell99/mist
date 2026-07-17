/**
 * Local-filesystem storage implementation (server-only): the same function
 * surface as google-drive.server.ts, backed by a folder on this machine via
 * the localfs sidecar (scripts/localfs-server.mjs). The Worker runs in workerd,
 * which cannot touch the host disk, so every operation is an HTTP call to the
 * sidecar on 127.0.0.1; the sidecar is the only process that reads or writes
 * files. Dev-only: enabled by LOCAL_FS_URL in .dev.vars, dispatched by the
 * google.server.ts facade, and never active on the deployed worker.
 *
 * Ids are reversible path encodings (see localfs-ids.ts), and the version
 * token is a content hash computed by the sidecar, which is the project's
 * "content is the source of truth" principle made literal: a re-save of
 * identical bytes keeps the same version, so the conflict machinery only
 * fires on a genuine change. Permissions are a constant anyone/writer grant:
 * the local user owns their own disk, and sign-in is bypassed in local mode.
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
import { idToPath, joinRel, nameOf, parentPath, pathToId, trailOf } from "./localfs-ids";
import { mimeForPath } from "./mime";

/** Token minted by the facade in local mode: the sidecar base URL behind a
 *  prefix, so every (token, ...) signature carries its own dispatch context. */
export const LOCAL_TOKEN_PREFIX = "localfs:";

export function isLocalToken(token: string): boolean {
  return token.startsWith(LOCAL_TOKEN_PREFIX);
}

function baseOf(token: string): string {
  return token.slice(LOCAL_TOKEN_PREFIX.length).replace(/\/$/, "");
}

/** Decode an id or fail like Drive fails on an unknown file. */
function pathOf(id: string): string {
  const path = idToPath(id);
  if (path === null) throw new Error("local file not found (not a local file id)");
  return path;
}

async function call<T>(token: string, pathAndQuery: string, init?: RequestInit): Promise<T> {
  const res = await fetch(baseOf(token) + pathAndQuery, init);
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
  mtimeMs: number;
  size: number;
  version: string | null;
}

function kindForLocal(name: string, isFolder: boolean): DriveKind {
  return isFolder ? "folder" : driveKind(mimeForPath(name), name);
}

export async function driveGetMeta(token: string, fileId: string): Promise<DriveFileMeta> {
  const path = pathOf(fileId);
  const stat = await call<Stat>(token, "/stat" + q({ path }));
  if (!stat.exists) throw new Error("local file not found");
  const parent = parentPath(path);
  return {
    id: fileId,
    name: path === "" ? stat.name : nameOf(path),
    parents: parent === null ? undefined : [pathToId(parent)],
    version: stat.version,
  };
}

export async function driveFileDetails(token: string, fileId: string): Promise<DriveFileDetails> {
  const path = pathOf(fileId);
  const stat = await call<Stat>(token, "/stat" + q({ path }));
  if (!stat.exists) throw new Error("local file not found");
  return {
    id: fileId,
    name: path === "" ? stat.name : nameOf(path),
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
  const path = idToPath(folderId);
  // A non-local id here (e.g. the Drive library folder default) is simply a
  // folder that does not exist locally: empty, not an error.
  if (path === null) return [];
  const { entries } = await call<{ entries: { name: string; isFolder: boolean }[] }>(
    token,
    "/list" + q({ path }),
  );
  return entries.map((e) => ({
    id: pathToId(path === "" ? e.name : `${path}/${e.name}`),
    name: e.name,
    isFolder: e.isFolder,
  }));
}

export async function driveResolvePath(
  token: string,
  folderId: string,
  relPath: string,
): Promise<string | null> {
  const base = pathOf(folderId);
  const joined = joinRel(base, relPath);
  if (joined === null) return null; // `..` walked past the root
  const stat = await call<Stat>(token, "/stat" + q({ path: joined }));
  if (!stat.exists) throw new Error(`path "${joined}" not found under the local root`);
  return pathToId(joined);
}

export async function driveTrail(_token: string, folderId: string): Promise<{ id: string; name: string }[]> {
  const path = idToPath(folderId);
  return path === null ? [] : trailOf(path);
}

export async function driveCreateFile(
  token: string,
  folderId: string,
  name: string,
  content = "",
): Promise<{ id: string; name: string }> {
  const folder = pathOf(folderId);
  const path = folder === "" ? name : `${folder}/${name}`;
  await call<{ version: string | null }>(token, "/write" + q({ path }), {
    method: "POST",
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: content,
  });
  return { id: pathToId(path), name };
}

export async function driveCreateBinary(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<{ id: string; name: string }> {
  const folder = pathOf(folderId);
  const path = folder === "" ? name : `${folder}/${name}`;
  await call<{ version: string | null }>(token, "/write" + q({ path }), {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  return { id: pathToId(path), name };
}

export async function driveEnsureSubfolder(token: string, parentId: string, name: string): Promise<string> {
  const parent = pathOf(parentId);
  const path = parent === "" ? name : `${parent}/${name}`;
  await call<{ ok: boolean }>(token, "/mkdir" + q({ path }), { method: "POST" });
  return pathToId(path);
}

/** Rename changes the path and therefore the id; an open room bound to the old
 *  id will stop resolving until the file is reopened. Documented limitation. */
export async function driveRename(token: string, fileId: string, name: string): Promise<void> {
  await call<{ name: string }>(token, "/rename" + q({ path: pathOf(fileId), name }), { method: "POST" });
}

export async function driveCopy(
  token: string,
  fileId: string,
  name?: string,
): Promise<{ id: string; name: string }> {
  const path = pathOf(fileId);
  const res = await call<{ name: string }>(token, "/copy" + q({ path, name }), { method: "POST" });
  const parent = parentPath(path) ?? "";
  return { id: pathToId(parent === "" ? res.name : `${parent}/${res.name}`), name: res.name };
}

export async function driveTrash(token: string, fileId: string): Promise<void> {
  await call<{ ok: boolean }>(token, "/trash" + q({ path: pathOf(fileId) }), { method: "POST" });
}

export async function driveDownload(token: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(baseOf(token) + "/raw" + q({ path: pathOf(fileId) }));
  if (!res.ok) throw new Error(`local read failed (${res.status})`);
  return res.arrayBuffer();
}

interface IndexEntry {
  relPath: string;
  isFolder: boolean;
}

function toSearchEntry(e: IndexEntry): DriveSearchEntry {
  const name = nameOf(e.relPath);
  const parent = parentPath(e.relPath) ?? "";
  const trail = trailOf(parent);
  return {
    id: pathToId(e.relPath),
    name,
    kind: kindForLocal(name, e.isFolder),
    webViewLink: null,
    path: trail.map((t) => t.name).join(" / "),
    parentId: pathToId(parent),
    trail,
  };
}

function filterKinds(entries: DriveSearchEntry[], types?: DriveKind[]): DriveSearchEntry[] {
  if (!types || !types.length) return entries;
  const wanted = new Set(types);
  return entries.filter((e) => wanted.has(e.kind));
}

export async function driveFiles(
  token: string,
  opts: { nameQuery?: string; folderId?: string; types?: DriveKind[]; fullText?: boolean; limit?: number },
): Promise<DriveSearchEntry[]> {
  const limit = opts.limit ?? 30;
  const folder = opts.folderId ? pathOf(opts.folderId) : undefined;
  const { files } = await call<{ files: IndexEntry[] }>(
    token,
    "/search" +
      q({
        q: opts.nameQuery,
        folder,
        full: opts.fullText ? 1 : undefined,
        // Fetch a superset so the kind filter below still fills the limit.
        limit: limit * 3,
      }),
  );
  return filterKinds(files.map(toSearchEntry), opts.types).slice(0, limit);
}

export async function driveFilesUnderFolders(
  token: string,
  folderIds: string[],
  types: DriveKind[],
  limit = 60,
): Promise<DriveSearchEntry[]> {
  const paths = folderIds.map((id) => idToPath(id)).filter((p): p is string => p !== null);
  if (!paths.length) return [];
  const { files } = await call<{ files: IndexEntry[] }>(token, "/children", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, limit }),
  });
  return filterKinds(files.map(toSearchEntry), types).slice(0, limit);
}

/** Local files are the user's own disk: one constant anyone/writer grant, so
 *  every ACL check passes with edit and no sidecar call is needed. */
export async function driveListPermissions(_token: string, _fileId: string): Promise<DriveGrant[]> {
  return [{ type: "anyone", role: "writer" }];
}
