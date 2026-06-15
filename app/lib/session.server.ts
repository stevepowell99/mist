/**
 * Signed session cookie for Google sign-in. After a user's Google ID token is
 * verified once (at /auth/google), we issue our own HMAC-signed cookie carrying
 * the verified email and an expiry, so every later request is checked locally
 * without calling Google again. The cookie is tamper-evident (HMAC-SHA256 over
 * the payload with SESSION_SECRET), not encrypted: it holds only an email and
 * expiry, nothing secret.
 */
export const SESSION_COOKIE = "mist_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

/** Constant-time-ish comparison of two base64url signatures. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Issue a signed session value for an email, valid for ttlSeconds. */
export async function signSession(
  email: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  now: number = Date.now(),
): Promise<string> {
  const payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ email, exp: Math.floor(now / 1000) + ttlSeconds })),
  );
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** Verify a session value, returning the email if the signature holds and it is
 *  not expired, otherwise null. */
export async function verifySession(
  value: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (!value || !secret) return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = b64urlEncode(await hmac(secret, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as {
      email?: string;
      exp?: number;
    };
    if (!claims.email || !claims.exp) return null;
    if (claims.exp < Math.floor(now / 1000)) return null;
    return claims.email;
  } catch {
    return null;
  }
}

/** Read the raw session cookie value from a request, or null. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

/** Set-Cookie header value for a fresh session (HttpOnly, Secure, Lax). */
export function sessionCookieHeader(value: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`;
}

/** Set-Cookie header value that clears the session. */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
