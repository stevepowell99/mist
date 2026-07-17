/**
 * Types and pure helpers shared by the two storage implementations (Google
 * Drive and local filesystem) and their facade. Nothing here fetches; the
 * implementations live in google-drive.server.ts and google-localfs.server.ts,
 * dispatched by google.server.ts.
 */

export interface DriveEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  /** Local-fs mode: base URL of the localfs sidecar (dev only, from .dev.vars).
   *  When set, storage is a local folder and Google is never contacted. */
  LOCAL_FS_URL?: string;
}

/** The synthetic signed-in identity in local-fs mode (no Google sign-in). */
export const LOCAL_USER_EMAIL = "local@localhost";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOC_MIME = "application/vnd.google-apps.document";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";

export interface DriveFileMeta {
  id: string;
  name: string;
  parents?: string[];
  /** headRevisionId (Drive) or a content hash (local fs): the version token
   *  for change detection. */
  version: string | null;
}

export interface DriveFileDetails {
  id: string;
  name: string;
  modifiedTime: string | null;
  size: number | null;
  owners: { name: string; email?: string }[];
  lastModifiedBy: { name: string; email?: string } | null;
  webViewLink: string | null;
}

export interface DriveEntry {
  id: string;
  name: string;
  isFolder: boolean;
}

/** Coarse file kind for the quick-open type filter and icons. */
export type DriveKind = "folder" | "markdown" | "doc" | "sheet" | "slides" | "pdf" | "image" | "other";

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

/** Emails on a file's sharing list (for the ACL check). */
export interface DriveGrant {
  /** "user", "group", "domain" or "anyone". */
  type: string;
  /** "owner", "organizer", "fileOrganizer", "writer", "commenter" or "reader". */
  role?: string;
  emailAddress?: string;
  domain?: string;
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
 * `.../d/<id>/...`, `...?id=<id>`, and a plain id (which includes the local-fs
 * `lf_...` ids, same alphabet).
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
