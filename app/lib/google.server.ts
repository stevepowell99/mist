/**
 * Server-only Google Drive helpers.
 *
 * The relay acts as one fixed identity (Steve's account) via a stored OAuth
 * refresh token, so all reads and writes use an access token minted from it.
 * The three secrets (client id, client secret, refresh token) are Worker
 * secrets and never reach the client. See plans/live-collab.md.
 */

export interface DriveEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** True when the three Drive secrets are present. */
export function driveConfigured(env: DriveEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

/** Mint a short-lived access token from the stored refresh token. */
export async function getDriveAccessToken(env: DriveEnv): Promise<string> {
  if (!driveConfigured(env)) {
    throw new Error("Drive not configured (missing Google secrets)");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Drive auth failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Drive auth returned no access token");
  return body.access_token;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

const COMMON = "supportsAllDrives=true";

export interface DriveFileMeta {
  id: string;
  name: string;
  parents?: string[];
  /** headRevisionId, the version token for change detection. */
  version: string | null;
}

/** File metadata: name, parent folder, and the head revision id (version). */
export async function driveGetMeta(token: string, fileId: string): Promise<DriveFileMeta> {
  const res = await fetch(
    `${DRIVE}/files/${fileId}?fields=id,name,parents,headRevisionId&${COMMON}`,
    { headers: authHeaders(token) },
  );
  if (res.status === 404) throw new Error("Drive file not found (or not shared with the relay account)");
  if (!res.ok) throw new Error(`Drive metadata failed (${res.status})`);
  const body = (await res.json()) as { id: string; name: string; parents?: string[]; headRevisionId?: string };
  return { id: body.id, name: body.name, parents: body.parents, version: body.headRevisionId ?? null };
}

/** File text content plus its version token. */
export async function driveRead(token: string, fileId: string): Promise<{ text: string; version: string | null }> {
  const meta = await driveGetMeta(token, fileId);
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media&${COMMON}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Drive read failed (${res.status})`);
  return { text: await res.text(), version: meta.version };
}

/** Overwrite a file's content, returning the new version token. */
export async function driveWrite(
  token: string,
  fileId: string,
  content: string,
): Promise<{ version: string | null }> {
  const res = await fetch(
    `${UPLOAD}/files/${fileId}?uploadType=media&fields=headRevisionId&${COMMON}`,
    {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "text/markdown" },
      body: content,
    },
  );
  if (!res.ok) throw new Error(`Drive write failed (${res.status})`);
  const body = (await res.json()) as { headRevisionId?: string };
  return { version: body.headRevisionId ?? null };
}

export interface DriveEntry {
  id: string;
  name: string;
  isFolder: boolean;
}

/** Immediate children of a folder (folders and files), non-trashed. */
export async function driveListFolder(token: string, folderId: string): Promise<DriveEntry[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await fetch(
    `${DRIVE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&orderBy=folder,name&${COMMON}&includeItemsFromAllDrives=true`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const body = (await res.json()) as { files: { id: string; name: string; mimeType: string }[] };
  return body.files.map((f) => ({ id: f.id, name: f.name, isFolder: f.mimeType === FOLDER_MIME }));
}

/**
 * Resolve a path relative to a folder to a file id, walking folders by name.
 * Handles `..` (up one folder) and `.`/empty segments. Returns null if any
 * segment is missing. Used to find a deck's `css:`/image assets in Drive.
 */
export async function driveResolvePath(
  token: string,
  folderId: string,
  relPath: string,
): Promise<string | null> {
  const segments = relPath.split("/").filter((s) => s && s !== ".");
  let current = folderId;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;
    if (seg === "..") {
      const meta = await driveGetMeta(token, current);
      if (!meta.parents?.[0]) return null;
      current = meta.parents[0];
      continue;
    }
    const entries = await driveListFolder(token, current);
    const match = entries.find((e) => e.name === seg && (last ? !e.isFolder : e.isFolder));
    if (!match) return null;
    current = match.id;
  }
  return current;
}

/** Raw bytes of a Drive file (for asset proxying). */
export async function driveDownload(token: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media&${COMMON}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return res.arrayBuffer();
}

/** Emails on a file's sharing list (for the later ACL check). */
export async function driveListPermissions(token: string, fileId: string): Promise<string[]> {
  const res = await fetch(
    `${DRIVE}/files/${fileId}/permissions?fields=permissions(emailAddress,type)&${COMMON}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`Drive permissions failed (${res.status})`);
  const body = (await res.json()) as { permissions: { emailAddress?: string; type: string }[] };
  return body.permissions.map((p) => p.emailAddress).filter((e): e is string => Boolean(e));
}

/**
 * Extract a Drive file id from a share URL or a bare id. Handles
 * `.../d/<id>/...`, `...?id=<id>`, and a plain id.
 */
export function parseDriveFileId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const dMatch = s.match(/\/d\/([\w-]+)/);
  if (dMatch) return dMatch[1];
  const idMatch = s.match(/[?&]id=([\w-]+)/);
  if (idMatch) return idMatch[1];
  if (/^[\w-]+$/.test(s)) return s;
  return null;
}
