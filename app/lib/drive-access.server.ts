/**
 * Access gate for the /drive/* endpoints: Google sign-in plus per-file Drive
 * sharing. The interim shared passphrase has been retired (#7).
 *
 * Authorisation model (decided 15 June 2026): a user may open a file iff the
 * file's own Drive sharing grants their email (or their domain, or anyone-with-
 * link). Drive sharing stays the single source of truth; mist keeps no separate
 * allowlist.
 */
import { verifySession, readSessionCookie, signAssetToken, verifyAssetToken } from "./session.server";
import {
  driveListPermissions,
  emailHasAccess,
  driveRoleForEmail,
  driveRoleCanEdit,
  getDriveAccessToken,
  type DriveEnv,
} from "./google.server";
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

/** The verified signed-in email from the session cookie, or null. */
export async function getRequestEmail(request: Request, env: DriveSessionEnv): Promise<string | null> {
  return verifySession(readSessionCookie(request), env.SESSION_SECRET ?? "");
}

/**
 * Gate for /drive/* endpoints: a valid Google session, or the shared passphrase
 * during the transition. Returns the email when a session is present.
 */
export async function driveAccess(request: Request, env: DriveSessionEnv): Promise<DriveAccess> {
  const email = await getRequestEmail(request, env);
  if (email) return { ok: true, email };
  // A signed asset token (minted from a valid session by the doc page) lets the
  // sandboxed slides iframe fetch assets without the session cookie. Coarse
  // access: email null, so per-file ACL is not enforced for assets.
  const token = new URL(request.url).searchParams.get("token");
  if (token && (await verifyAssetToken(token, env.SESSION_SECRET ?? ""))) return { ok: true, email: null };
  return { ok: false, email: null };
}

/**
 * Mint a short-lived asset token for a holder of a valid doc key (the secret
 * link). The asset token lets the sandboxed slides iframe fetch the deck's
 * private-Drive CSS/images, so a collaborator opening a share link sees styles
 * and images without a Google account, matching the no-account model. The token
 * is coarse (it does not carry a per-file ACL), exactly like the session-minted
 * one. Returns null if the doc key was invalid or there is no signing secret.
 */
export async function mintAssetTokenForDoc(env: DriveSessionEnv, hasValidKey: boolean): Promise<string | null> {
  if (!hasValidKey || !env.SESSION_SECRET) return null;
  return signAssetToken(env.SESSION_SECRET);
}

/** Mint a short-lived asset token if the request is authorised; else null. */
export async function mintAssetToken(request: Request, env: DriveSessionEnv): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  const access = await driveAccess(request, env);
  if (!access.ok) return null;
  return signAssetToken(env.SESSION_SECRET);
}

/**
 * Whether a user may open a specific Drive file, by that file's sharing. A
 * passphrase-only session (email null) passes, since the passphrase is the
 * coarse transition gate; once sign-in is the only gate, every request carries
 * an email and per-file sharing is enforced.
 */
export async function canAccessFile(
  env: DriveSessionEnv,
  fileId: string,
  email: string | null,
): Promise<boolean> {
  if (!email) return true;
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
 * the user has no access at all. A session without an email (asset-token path)
 * gets "edit", since there is no per-user role to enforce there.
 */
export async function fileAccessRole(
  env: DriveSessionEnv,
  fileId: string,
  email: string | null,
): Promise<DocRole | null> {
  if (!email) return "edit";
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

/** 401 for no/expired session and no passphrase. */
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
