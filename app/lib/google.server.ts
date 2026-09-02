/**
 * Storage facade (server-only): the one module the rest of the app imports for
 * document storage. It dispatches every call to one of two implementations
 * with identical function surfaces:
 *
 *  - google-drive.server.ts — Google Drive via the relay identity (production).
 *  - google-localfs.server.ts — a local folder via the localfs sidecar
 *    (dev-only, enabled by LOCAL_FS_URL in .dev.vars; see the sidecar,
 *    scripts/localfs-server.mjs).
 *
 * The mode is decided once, in getDriveAccessToken: a local-mode "token" is
 * the sidecar base URL behind a prefix, so each (token, ...) call knows its
 * own backend with no ambient state. Production never sets LOCAL_FS_URL, so
 * the deployed worker is Drive-only by construction.
 */
import * as gdrive from "./google-drive.server";
import * as localfs from "./google-localfs.server";
import { isLocalToken, packLocalToken, resolveLocalPath } from "./google-localfs.server";
import type {
  DriveEntry,
  DriveEnv,
  DriveFileDetails,
  DriveFileMeta,
  DriveGrant,
  DriveKind,
  DriveSearchEntry,
} from "./drive-common";

export * from "./drive-common";

/** True when storage is a local folder via the sidecar (dev-only). */
export function isLocalMode(env: DriveEnv): boolean {
  return Boolean(env.LOCAL_FS_URL);
}

/** True when a storage backend is available (local folder, or Drive secrets). */
export function driveConfigured(env: DriveEnv): boolean {
  return isLocalMode(env) || gdrive.driveConfigured(env);
}

/** The per-call backend token: local mode packs the sidecar URL and its shared
 *  secret; Drive mints a Google access token from the stored refresh token. */
export async function getDriveAccessToken(env: DriveEnv): Promise<string> {
  if (env.LOCAL_FS_URL) return packLocalToken(env.LOCAL_FS_URL, env.LOCAL_FS_TOKEN ?? "");
  return gdrive.getDriveAccessToken(env);
}

/** Local mode only: an absolute path on this machine to a { id, name }, or null
 *  if the sidecar refuses it. The /open?path= route uses this to turn a path
 *  from an external tool (TagFox) into a room. Throws in Drive mode, which has
 *  no filesystem paths. */
export async function resolveLocalFilePath(
  env: DriveEnv,
  absPath: string,
): Promise<{ id: string; name: string } | null> {
  if (!env.LOCAL_FS_URL) throw new Error("resolveLocalFilePath is local-mode only");
  return resolveLocalPath(await getDriveAccessToken(env), absPath);
}

/** The operations both implementations provide; assigning localfs here is the
 *  compile-time guard that the two surfaces stay in step. */
type StorageOps = Pick<
  typeof gdrive,
  | "driveGetMeta" | "driveFileDetails" | "driveRead" | "driveWrite"
  | "driveListFolder" | "driveResolvePath" | "driveTrail"
  | "driveCreateFile" | "driveCreateBinary" | "driveEnsureSubfolder"
  | "driveRename" | "driveCopy" | "driveTrash" | "driveDownload"
  | "driveFiles" | "driveFilesUnderFolders" | "driveListPermissions"
>;

function impl(token: string): StorageOps {
  return isLocalToken(token) ? localfs : gdrive;
}

export function driveGetMeta(token: string, fileId: string): Promise<DriveFileMeta> {
  return impl(token).driveGetMeta(token, fileId);
}

export function driveFileDetails(token: string, fileId: string): Promise<DriveFileDetails> {
  return impl(token).driveFileDetails(token, fileId);
}

/** File text content plus its version token, canonicalised to LF. CodeMirror
 *  represents its document with \n only (it drops \r), so a CRLF file in the
 *  Y.Text desyncs every editor position after a line break and corrupts edits.
 *  Every read flows through here (initial open and the agent's upstream check),
 *  so normalising here keeps the CRDT, the editor, the body comparison and the
 *  next save all on \n. A CRLF file becomes LF on its first gmist save, which
 *  is standard and harmless. */
export async function driveRead(token: string, fileId: string): Promise<{ text: string; version: string | null }> {
  const { text, version } = await impl(token).driveRead(token, fileId);
  return { text: text.replace(/\r\n?/g, "\n"), version };
}

export function driveWrite(
  token: string,
  fileId: string,
  content: string,
  expectedVersion?: string | null,
  client?: string | null,
): Promise<{ version: string | null }> {
  return impl(token).driveWrite(token, fileId, content, expectedVersion, client);
}

export function driveListFolder(token: string, folderId: string): Promise<DriveEntry[]> {
  return impl(token).driveListFolder(token, folderId);
}

export function driveResolvePath(token: string, folderId: string, relPath: string): Promise<string | null> {
  return impl(token).driveResolvePath(token, folderId, relPath);
}

export function driveTrail(token: string, folderId: string): Promise<{ id: string; name: string }[]> {
  return impl(token).driveTrail(token, folderId);
}

export function driveCreateFile(
  token: string,
  folderId: string,
  name: string,
  content = "",
): Promise<{ id: string; name: string }> {
  return impl(token).driveCreateFile(token, folderId, name, content);
}

export function driveCreateBinary(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<{ id: string; name: string }> {
  return impl(token).driveCreateBinary(token, folderId, name, mimeType, bytes);
}

export function driveEnsureSubfolder(token: string, parentId: string, name: string): Promise<string> {
  return impl(token).driveEnsureSubfolder(token, parentId, name);
}

export function driveRename(token: string, fileId: string, name: string): Promise<void> {
  return impl(token).driveRename(token, fileId, name);
}

export function driveCopy(token: string, fileId: string, name?: string): Promise<{ id: string; name: string }> {
  return impl(token).driveCopy(token, fileId, name);
}

export function driveTrash(token: string, fileId: string): Promise<void> {
  return impl(token).driveTrash(token, fileId);
}

export function driveDownload(token: string, fileId: string): Promise<ArrayBuffer> {
  return impl(token).driveDownload(token, fileId);
}

export function driveFiles(
  token: string,
  opts: { nameQuery?: string; folderId?: string; types?: DriveKind[]; fullText?: boolean; limit?: number },
): Promise<DriveSearchEntry[]> {
  return impl(token).driveFiles(token, opts);
}

export function driveFilesUnderFolders(
  token: string,
  folderIds: string[],
  types: DriveKind[],
  limit = 60,
): Promise<DriveSearchEntry[]> {
  return impl(token).driveFilesUnderFolders(token, folderIds, types, limit);
}

export function driveListPermissions(token: string, fileId: string): Promise<DriveGrant[]> {
  return impl(token).driveListPermissions(token, fileId);
}
