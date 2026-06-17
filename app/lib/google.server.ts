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
// Cache the relay's Google access token across requests in this isolate. Google
// access tokens last ~1 hour; without caching every /drive/asset (one per slide
// background, css file, image) triggered its own refresh-token grant, and a deck
// opening fires a dozen at once, so Google rate-limited the grants and assets
// failed intermittently. Cache and reuse until shortly before expiry.
let cachedDriveToken: { token: string; exp: number } | null = null;
let inflightDriveToken: Promise<string> | null = null;

export async function getDriveAccessToken(env: DriveEnv): Promise<string> {
  if (!driveConfigured(env)) {
    throw new Error("Drive not configured (missing Google secrets)");
  }
  const now = Date.now();
  if (cachedDriveToken && cachedDriveToken.exp > now + 60_000) return cachedDriveToken.token;
  // Coalesce concurrent refreshes (a deck opens many asset requests at once) so
  // only one grant is in flight at a time.
  if (inflightDriveToken) return inflightDriveToken;
  inflightDriveToken = (async () => {
    try {
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
      const body = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) throw new Error("Drive auth returned no access token");
      cachedDriveToken = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
      return body.access_token;
    } finally {
      inflightDriveToken = null;
    }
  })();
  return inflightDriveToken;
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
    if (!match) {
      // Report which segment failed and what the folder did contain, so a 404
      // is diagnosable (e.g. the `img` subfolder is missing or named differently).
      const near = entries.filter((e) => (last ? !e.isFolder : e.isFolder)).map((e) => e.name).slice(0, 12);
      throw new Error(`path segment "${seg}" not found in folder ${current}; available: ${near.join(", ") || "(none)"}`);
    }
    current = match.id;
  }
  return current;
}

/** The folder trail from the top down to (and including) the given folder, for
 *  a clickable breadcrumb. Capped in depth; drops the "My Drive" root. */
export async function driveTrail(token: string, folderId: string): Promise<{ id: string; name: string }[]> {
  const trail: { id: string; name: string }[] = [];
  let id: string | undefined = folderId;
  let guard = 0;
  while (id && guard++ < 8) {
    let meta: { name: string; parents?: string[] };
    try {
      meta = await driveGetMeta(token, id);
    } catch {
      break;
    }
    if (meta.name && meta.name !== "My Drive") trail.unshift({ id, name: meta.name });
    id = meta.parents?.[0];
  }
  return trail;
}

/** Create a new file in a folder with the given name and (markdown) content. */
export async function driveCreateFile(
  token: string,
  folderId: string,
  name: string,
  content = "",
): Promise<{ id: string; name: string }> {
  const boundary = "mist-" + name.length + "-boundary";
  const metadata = { name, parents: [folderId], mimeType: "text/markdown" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name&${COMMON}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`);
  const f = (await res.json()) as { id: string; name: string };
  return { id: f.id, name: f.name };
}

/** Create a binary file (e.g. a pasted image) in a folder. The multipart body
 *  is a Blob so the raw bytes are sent verbatim, not stringified. */
export async function driveCreateBinary(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<{ id: string; name: string }> {
  const boundary = "mist-bin-boundary";
  const metadata = { name, parents: [folderId], mimeType };
  const pre =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const body = new Blob([pre, new Uint8Array(bytes), post]);
  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name&${COMMON}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`);
  const f = (await res.json()) as { id: string; name: string };
  return { id: f.id, name: f.name };
}

/** Find a named subfolder of `parentId`, creating it if absent. Returns its id.
 *  Used to collect pasted images in an `img/` folder beside the document. */
export async function driveEnsureSubfolder(token: string, parentId: string, name: string): Promise<string> {
  const entries = await driveListFolder(token, parentId);
  const existing = entries.find((e) => e.isFolder && e.name === name);
  if (existing) return existing.id;
  const res = await fetch(`${DRIVE}/files?fields=id&${COMMON}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_MIME }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

/** Rename a file. */
export async function driveRename(token: string, fileId: string, name: string): Promise<void> {
  const res = await fetch(`${DRIVE}/files/${fileId}?fields=id&${COMMON}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive rename failed (${res.status})`);
}

/** Duplicate a file (same folder), optionally with a new name. */
export async function driveCopy(
  token: string,
  fileId: string,
  name?: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${DRIVE}/files/${fileId}/copy?fields=id,name&${COMMON}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) throw new Error(`Drive copy failed (${res.status})`);
  const f = (await res.json()) as { id: string; name: string };
  return { id: f.id, name: f.name };
}

/** Move a file to the Drive trash (recoverable), not a permanent delete. */
export async function driveTrash(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE}/files/${fileId}?fields=id&${COMMON}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok) throw new Error(`Drive trash failed (${res.status})`);
}

/** Raw bytes of a Drive file (for asset proxying). */
export async function driveDownload(token: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media&${COMMON}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return res.arrayBuffer();
}

/** Coarse file kind for the quick-open type filter and icons. */
export type DriveKind = "folder" | "markdown" | "doc" | "sheet" | "slides" | "pdf" | "image" | "other";

const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SLIDES_MIME = "application/vnd.google-apps.presentation";

export function driveKind(mimeType: string, name: string): DriveKind {
  if (mimeType === FOLDER_MIME) return "folder";
  if (mimeType === DOC_MIME) return "doc";
  if (mimeType === SHEET_MIME) return "sheet";
  if (mimeType === SLIDES_MIME) return "slides";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (/\.(md|qmd)$/i.test(name)) return "markdown";
  return "other";
}

// Each filterable kind to a Drive query clause. "markdown" is by name suffix
// (Drive types .md/.qmd inconsistently); "other" is not filterable, so omitted.
const KIND_CLAUSE: Partial<Record<DriveKind, string>> = {
  folder: `mimeType = '${FOLDER_MIME}'`,
  doc: `mimeType = '${DOC_MIME}'`,
  sheet: `mimeType = '${SHEET_MIME}'`,
  slides: `mimeType = '${SLIDES_MIME}'`,
  pdf: `mimeType = 'application/pdf'`,
  image: `mimeType contains 'image/'`,
  markdown: `(name contains '.md' or name contains '.qmd')`,
};

export interface DriveSearchEntry {
  id: string;
  name: string;
  kind: DriveKind;
  webViewLink: string | null;
  /** Parent folder path, e.g. "Causal Map / 19c-slides", "" at the root. */
  path: string;
  /** Parent folder id, so a search result's path is clickable to browse there. */
  parentId: string | null;
  /** Ancestor folders top -> immediate parent, so each path segment is its own
   *  clickable breadcrumb (not just the whole path to the immediate parent). */
  trail: { id: string; name: string }[];
}

function escapeQ(s: string): string {
  return s.replace(/['\\]/g, "\\$&");
}

// Generated/build directories that fill Drive with sludge; results in or named
// after these are dropped from search. Drive's query cannot exclude by ancestor,
// so this is a post-filter on the resolved path.
const SLUDGE_DIRS = new Set([
  ".quarto", "_freeze", "site_libs", "_site", "_book", "node_modules",
  ".git", ".obsidian", "_extensions",
]);

function isSludge(name: string, path: string): boolean {
  const segs = [name, ...path.split(" / ")].map((s) => s.trim());
  return segs.some((s) => SLUDGE_DIRS.has(s) || /_files$/.test(s));
}

/** Resolve a file's parent-folder path, memoising folders across the request so
 *  many results in the same tree cost only a few extra calls. Capped in depth. */
async function resolveFolderPath(
  token: string,
  parents: string[] | undefined,
  cache: Map<string, { name: string; parent?: string }>,
): Promise<{ path: string; trail: { id: string; name: string }[] }> {
  let id = parents?.[0];
  const trail: { id: string; name: string }[] = [];
  let guard = 0;
  while (id && guard++ < 5) {
    let info = cache.get(id);
    if (!info) {
      try {
        const meta = await driveGetMeta(token, id);
        info = { name: meta.name, parent: meta.parents?.[0] };
      } catch {
        info = { name: "" };
      }
      cache.set(id, info);
    }
    if (info.name && info.name !== "My Drive") trail.unshift({ id, name: info.name });
    id = info.parent;
  }
  return { path: trail.map((t) => t.name).join(" / "), trail };
}

/**
 * List Drive files for the quick-open box. With `folderId` it lists that folder;
 * with `nameQuery` it name-matches; with neither it returns recent files. `types`
 * restricts to the given kinds (server-side, so junk does not crowd out matches).
 */
export async function driveFiles(
  token: string,
  opts: { nameQuery?: string; folderId?: string; types?: DriveKind[]; fullText?: boolean },
): Promise<DriveSearchEntry[]> {
  const clauses = ["trashed = false"];
  if (opts.folderId) clauses.push(`'${escapeQ(opts.folderId)}' in parents`);
  if (opts.nameQuery) {
    const q = escapeQ(opts.nameQuery);
    // fullText also matches a file's CONTENT, so a deck whose filename is generic
    // (slides.qmd) still matches on its title/body text.
    clauses.push(opts.fullText ? `(name contains '${q}' or fullText contains '${q}')` : `name contains '${q}'`);
  }
  const typeParts = (opts.types ?? []).map((t) => KIND_CLAUSE[t]).filter(Boolean);
  if (typeParts.length) clauses.push(`(${typeParts.join(" or ")})`);

  const orderBy = opts.nameQuery || opts.folderId ? "folder,name" : "viewedByMeTime desc";
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,mimeType,webViewLink,parents)",
    pageSize: "30",
    orderBy,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`${DRIVE}/files?${params.toString()}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Drive search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    files: { id: string; name: string; mimeType: string; webViewLink?: string; parents?: string[] }[];
  };

  // The markdown clause (name contains '.md') over-matches (e.g. "x.md.json"),
  // so re-check the classified kind against the requested types and drop misses.
  const wanted = opts.types && opts.types.length ? new Set(opts.types) : null;
  const cache = new Map<string, { name: string; parent?: string }>();
  const entries: DriveSearchEntry[] = [];
  for (const f of body.files) {
    const kind = driveKind(f.mimeType, f.name);
    if (wanted && !wanted.has(kind)) continue;
    const { path, trail } = await resolveFolderPath(token, f.parents, cache);
    if (isSludge(f.name, path)) continue; // drop generated/build directories
    entries.push({ id: f.id, name: f.name, kind, webViewLink: f.webViewLink ?? null, path, parentId: f.parents?.[0] ?? null, trail });
  }
  return entries;
}

/** Emails on a file's sharing list (for the ACL check). */
export interface DriveGrant {
  /** "user", "group", "domain" or "anyone". */
  type: string;
  /** "owner", "organizer", "fileOrganizer", "writer", "commenter" or "reader". */
  role?: string;
  emailAddress?: string;
  domain?: string;
}

/** A file's sharing grants (who it is shared with, and how). */
export async function driveListPermissions(token: string, fileId: string): Promise<DriveGrant[]> {
  const res = await fetch(
    `${DRIVE}/files/${fileId}/permissions?fields=permissions(emailAddress,type,domain,role)&${COMMON}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`Drive permissions failed (${res.status})`);
  const body = (await res.json()) as { permissions: DriveGrant[] };
  return body.permissions ?? [];
}

/** Whether a grant applies to this email: a direct user grant, a domain grant
 *  matching the email's domain, or anyone-with-link. Group membership is not
 *  resolved (it would need extra calls), so a group-only share is not matched. */
function grantMatches(g: DriveGrant, email: string, domain: string): boolean {
  return (
    g.type === "anyone" ||
    (g.type === "user" && g.emailAddress?.toLowerCase() === email) ||
    (g.type === "domain" && !!domain && g.domain?.toLowerCase() === domain)
  );
}

/** True when an email is authorised by a file's sharing grants (any role). */
export function emailHasAccess(grants: DriveGrant[], email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const domain = e.split("@")[1] ?? "";
  return grants.some((g) => grantMatches(g, e, domain));
}

const ROLE_RANK: Record<string, number> = {
  owner: 5, organizer: 4, fileOrganizer: 4, writer: 3, commenter: 2, reader: 1,
};

/** The highest Drive role an email is granted on a file (across direct, domain
 *  and anyone grants), or null if it has no access. */
export function driveRoleForEmail(grants: DriveGrant[], email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const domain = e.split("@")[1] ?? "";
  let best = 0;
  let bestRole: string | null = null;
  for (const g of grants) {
    if (!grantMatches(g, e, domain)) continue;
    const rank = ROLE_RANK[g.role ?? ""] ?? 0;
    if (rank > best) {
      best = rank;
      bestRole = g.role ?? null;
    }
  }
  return bestRole;
}

/** True when the Drive role allows editing the file (owner/organizer/writer). */
export function driveRoleCanEdit(role: string | null): boolean {
  return role === "owner" || role === "organizer" || role === "fileOrganizer" || role === "writer";
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
