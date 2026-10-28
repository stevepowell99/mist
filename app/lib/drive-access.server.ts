/**
 * Access gate for the /drive/* endpoints: Google sign-in plus per-file Drive
 * sharing. The interim shared passphrase has been retired (#7).
 *
 * Authorisation model (decided 15 June 2026): a user may open a file iff the
 * file's own Drive sharing grants their email (or their domain, or anyone-with-
 * link). Drive sharing stays the single source of truth; mist keeps no separate
 * allowlist.
 */
import {
  verifySession,
  readSessionCookie,
  signAssetToken,
  verifyAssetToken,
  type AssetScope,
} from "./session.server";
import {
  driveListPermissions,
  emailHasAccess,
  driveRoleForEmail,
  driveRoleCanEdit,
  getDriveAccessToken,
  driveConfigured,
  isLocalMode,
  LOCAL_USER_EMAIL,
  type DriveEnv,
} from "./google.server";
import { json } from "./http.server";
import type { DocRole, DriveMeta } from "~/shared/types";

export interface DriveSessionEnv extends DriveEnv {
  SESSION_SECRET?: string;
  GOOGLE_SIGNIN_CLIENT_ID?: string;
}

export interface DriveAccess {
  ok: boolean;
  /** The signed-in email, or null for a passphrase-only (transition) session. */
  email: string | null;
}

/** The verified signed-in email from the session cookie, or null. In local-fs
 *  mode there is no Google sign-in: every request is the local user, whose
 *  files these are, so a fixed synthetic identity stands in. */
export async function getRequestEmail(request: Request, env: DriveSessionEnv): Promise<string | null> {
  if (isLocalMode(env)) return LOCAL_USER_EMAIL;
  return verifySession(readSessionCookie(request), env.SESSION_SECRET ?? "");
}

/**
 * Gate for /drive/* endpoints: a valid Google session (in local mode, the local
 * user). An asset token is never a session here: /drive/asset reads one itself
 * through `assetAccess`, and nothing else accepts one.
 */
export async function driveAccess(request: Request, env: DriveSessionEnv): Promise<DriveAccess> {
  const email = await getRequestEmail(request, env);
  if (email) return { ok: true, email };
  return { ok: false, email: null };
}

/**
 * The shared opening gate for the /drive/* endpoints: a valid session AND Drive
 * configured. Returns the verified access, or an error Response to return
 * as-is, so each route drops the repeated four-line preamble. Routes with their
 * own bespoke flow (per-file ACL, key-gated folder listing) still call the
 * finer-grained helpers directly.
 */
export async function openDriveRequest(
  request: Request,
  env: DriveSessionEnv,
): Promise<{ access: DriveAccess } | { error: Response }> {
  const access = await driveAccess(request, env);
  if (!access.ok) return { error: driveUnauthenticated() };
  if (!driveConfigured(env)) return { error: json({ error: "Drive not configured" }, 501) };
  return { access };
}

/**
 * Who is asking /drive/asset for a file: a session (or local mode), or else the
 * scope of a valid asset token in `?token=`. Null when neither.
 */
export type AssetAccess = { session: string } | { scope: AssetScope };
export async function assetAccess(request: Request, env: DriveSessionEnv): Promise<AssetAccess | null> {
  const email = await getRequestEmail(request, env);
  if (email) return { session: email };
  const scope = await verifyAssetToken(new URL(request.url).searchParams.get("token"), env.SESSION_SECRET ?? "");
  return scope ? { scope } : null;
}

/**
 * A deck token for a viewer who has already passed that deck's access check
 * (see session.server.ts): what the editor's sandboxed preview and the print
 * page use. Null without a deck or a signing secret.
 */
export async function mintDeckToken(
  env: DriveSessionEnv,
  deck: string | null | undefined,
  email: string | null,
): Promise<string | null> {
  if (!deck || !email || !env.SESSION_SECRET) return null;
  return signAssetToken(env.SESSION_SECRET, { deck, email });
}

/** Stands in for the token while a public deck page is built; see `signAssetUrls`. */
export const ASSET_TOKEN_PLACEHOLDER = "MISTASSETTOKEN";

/**
 * Give every /drive/asset URL in a built page its own single-asset token, in
 * place of `ASSET_TOKEN_PLACEHOLDER`. The public `/slides` page is built on the
 * server, so it can sign each asset it renders rather than hand out a key to
 * the deck's folder: the link then reaches exactly what the deck shows. The
 * token signs the asset as /drive/asset will read it back (`searchParams`).
 */
export async function signAssetUrls(html: string, env: DriveSessionEnv): Promise<string> {
  const secret = env.SESSION_SECRET;
  const re = new RegExp(String.raw`/drive/asset\?([^"\s<>]*?)token=${ASSET_TOKEN_PLACEHOLDER}`, "g");
  const queries = new Set<string>();
  for (const m of html.matchAll(re)) queries.add(m[1]);
  const signed = new Map<string, string>();
  for (const q of queries) {
    const p = new URLSearchParams(q);
    const id = p.get("id");
    const deck = p.get("deck");
    const path = p.get("path");
    const scope = id ? { asset: `id:${id}` } : deck && path ? { deck, asset: `path:${path}` } : null;
    signed.set(q, scope && secret ? await signAssetToken(secret, scope) : "");
  }
  return html.replace(re, (_m, q: string) => `/drive/asset?${q}token=${encodeURIComponent(signed.get(q) ?? "")}`);
}

/**
 * Whether a user may open a specific Drive file, by that file's sharing.
 * Fails closed without an email.
 */
export async function canAccessFile(
  env: DriveSessionEnv,
  fileId: string,
  email: string | null,
): Promise<boolean> {
  if (!email) return false;
  try {
    const token = await getDriveAccessToken(env);
    const grants = await driveListPermissions(token, fileId);
    return emailHasAccess(grants, email);
  } catch {
    return false; // fail closed if we cannot read the sharing
  }
}

/**
 * The mist role a user gets when opening a Drive file, from the file's own
 * sharing: a writer/owner edits; a commenter or reader gets suggest-only (their
 * changes land as CriticMarkup suggestions, never silent edits). Returns null if
 * the user has no access at all, or there is no email to check.
 */
export async function fileAccessRole(
  env: DriveSessionEnv,
  fileId: string,
  email: string | null,
): Promise<DocRole | null> {
  if (!email) return null;
  try {
    const token = await getDriveAccessToken(env);
    const grants = await driveListPermissions(token, fileId);
    const role = driveRoleForEmail(grants, email);
    if (!role) return null;
    return driveRoleCanEdit(role) ? "edit" : "suggest";
  } catch {
    return null; // fail closed if we cannot read the sharing
  }
}

/**
 * The single authorisation decision for OPENING / EDITING an existing document,
 * used by both the doc loader and the WebSocket gate so they cannot drift. The
 * secret link key alone is NOT enough: a Drive-bound doc also requires a signed-
 * in user whom the file's own Drive sharing grants. The effective role is the
 * more restrictive of the link's role and the user's Drive role (a suggest link
 * stays suggest; a Drive commenter never edits, even on an edit link).
 *
 *  - "badkey":    the URL key matches no role on this doc.
 *  - "needsAuth": Drive-bound, but the request carries no signed-in session.
 *  - "forbidden": signed in, but the file's Drive sharing does not grant them.
 *  - "ok":        allowed, with the effective role.
 *
 * A doc with no Drive file (legacy/unbound) has no ACL to enforce, so the key
 * stays its only gate.
 */
export type DocAuthStatus = "ok" | "needsAuth" | "forbidden" | "badkey";
export async function authorizeDoc(
  env: DriveSessionEnv,
  request: Request,
  drive: DriveMeta | null,
  keyRole: DocRole | null,
): Promise<{ status: DocAuthStatus; role: DocRole | null; email: string | null }> {
  if (!keyRole) return { status: "badkey", role: null, email: null };
  if (!drive?.fileId) return { status: "ok", role: keyRole, email: null }; // unbound: key only
  const email = await getRequestEmail(request, env);
  if (!email) return { status: "needsAuth", role: null, email: null };
  const driveRole = await fileAccessRole(env, drive.fileId, email);
  if (!driveRole) return { status: "forbidden", role: null, email };
  const role: DocRole = keyRole === "edit" ? driveRole : "suggest";
  return { status: "ok", role, email };
}

/** 401 for no/expired session. */
export function driveUnauthenticated(): Response {
  return new Response(JSON.stringify({ error: "sign in required" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** 403 for a signed-in user who is not shared on the requested file. */
export function driveForbidden(): Response {
  return new Response(JSON.stringify({ error: "you do not have access to this file" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Verify a Google ID token (the credential from the Identity Services button)
 * and return the verified email, or null. Uses Google's tokeninfo endpoint so
 * we do not have to carry JWKS/crypto here; this runs once per sign-in, not per
 * request (the session cookie covers the rest).
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<string | null> {
  if (!idToken || !clientId) return null;
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) return null;
  const c = (await res.json()) as {
    aud?: string;
    iss?: string;
    email?: string;
    email_verified?: string | boolean;
  };
  if (c.aud !== clientId) return null;
  if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") return null;
  if (c.email_verified !== "true" && c.email_verified !== true) return null;
  return c.email ?? null;
}
