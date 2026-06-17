import type { Route } from "./+types/auth.google";
import { getCloudflare } from "~/lib/cloudflare.server";
import { verifyGoogleIdToken, type DriveSessionEnv } from "~/lib/drive-access.server";
import {
  signSession,
  verifySession,
  readSessionCookie,
  sessionCookieHeader,
} from "~/lib/session.server";
import { json } from "~/lib/http.server";

/** GET: the current signed-in email (for the UI to reflect sign-in state). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context) as { env: DriveSessionEnv };
  const email = await verifySession(readSessionCookie(request), env.SESSION_SECRET ?? "");
  return json({ email, clientId: env.GOOGLE_SIGNIN_CLIENT_ID ?? null });
}

/**
 * POST { credential }: verify the Google Identity Services ID token and, on
 * success, set a signed session cookie carrying the verified email.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { env } = getCloudflare(context) as { env: DriveSessionEnv };
  const clientId = env.GOOGLE_SIGNIN_CLIENT_ID;
  const secret = env.SESSION_SECRET;
  if (!clientId || !secret) return json({ error: "sign-in is not configured" }, 501);

  let body: { credential?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!body.credential) return json({ error: "missing credential" }, 400);

  const email = await verifyGoogleIdToken(body.credential, clientId);
  if (!email) return json({ error: "could not verify Google sign-in" }, 401);

  const value = await signSession(email, secret);
  return json({ email }, 200, { "Set-Cookie": sessionCookieHeader(value) });
}
