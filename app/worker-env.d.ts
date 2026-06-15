// Secrets set via `wrangler secret put` are not in wrangler.jsonc, so the
// generated Env type does not know about them. Declare them here.
interface Env {
  /** Fine-grained GitHub PAT (contents read/write on selected repos), server-side only */
  GITHUB_TOKEN?: string;
  /** Google OAuth client id for the Drive relay identity, server-side only */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret, server-side only */
  GOOGLE_CLIENT_SECRET?: string;
  /** Google OAuth refresh token for the Drive relay identity, server-side only */
  GOOGLE_REFRESH_TOKEN?: string;
  /** OAuth 2.0 Web client id for Google Identity Services sign-in (public, sent to the browser) */
  GOOGLE_SIGNIN_CLIENT_ID?: string;
  /** HMAC secret used to sign the session cookie, server-side only */
  SESSION_SECRET?: string;
}
