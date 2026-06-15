// One-time helper to mint a Google OAuth refresh token for the Drive relay,
// for LOCAL dev. Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .dev.vars,
// runs the consent flow on a loopback redirect, and writes GOOGLE_REFRESH_TOKEN
// back into .dev.vars. No npm deps; needs Node 20+ (global fetch).
//
// BEFORE running: in Google Cloud console > APIs & Services > Credentials, open
// the OAuth client whose id/secret you use, and add this exact redirect URI to
// "Authorized redirect URIs", then Save:
//
//     http://localhost:53682/
//
// Then: node scripts/get-refresh-token.mjs
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const ENV_PATH = new URL("../.dev.vars", import.meta.url);
const REDIRECT = "http://localhost:53682/";
const SCOPE = "https://www.googleapis.com/auth/drive";

function readVars() {
  const text = readFileSync(ENV_PATH, "utf8");
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2];
  }
  return { text, vars };
}

function writeRefreshToken(text, token) {
  const line = `GOOGLE_REFRESH_TOKEN=${token}`;
  const next = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(text)
    ? text.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line)
    : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, next);
}

const { text, vars } = readVars();
const clientId = vars.GOOGLE_CLIENT_ID;
const clientSecret = vars.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Fill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .dev.vars first.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  }).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback.");
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const body = await tokenRes.json();
    if (!body.refresh_token) {
      res.writeHead(500).end("No refresh_token returned. Check console output.");
      console.error("Token response had no refresh_token:", body);
      server.close();
      process.exit(1);
    }
    writeRefreshToken(text, body.refresh_token);
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Done. Refresh token written to .dev.vars.</h2><p>You can close this tab and restart <code>npm run dev</code>.</p>",
    );
    console.log("\nSuccess: GOOGLE_REFRESH_TOKEN written to .dev.vars.");
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500).end("Token exchange failed; see console.");
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(53682, () => {
  console.log("\nOpen this URL in your browser to authorise (also trying to open it for you):\n");
  console.log(authUrl + "\n");
  // Best-effort browser open on Windows.
  try {
    spawn("cmd", ["/c", "start", "", authUrl], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* just use the printed URL */
  }
});
