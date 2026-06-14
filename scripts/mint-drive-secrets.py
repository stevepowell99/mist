#!/usr/bin/env python3
"""
One-shot setup: mint a Google Drive refresh token and load all three Drive
secrets into the mist Cloudflare Worker. No copy-paste of secrets, no OAuth
Playground.

Usage (from anywhere):
    python scripts/mint-drive-secrets.py [path-to-client_secret.json]

If no path is given, the newest client_secret_*.json in your Downloads is used.
Use a Desktop-type OAuth client so no redirect URI needs registering. The
script opens your browser once, you click Allow, and it writes
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN as Worker
secrets via wrangler. The secret values are never printed.
"""

import glob
import http.server
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

SCOPE = "https://www.googleapis.com/auth/drive"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
PORT = 8976
REDIRECT = f"http://localhost:{PORT}/"
MIST_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_client_json(arg):
    if arg:
        return arg
    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    matches = sorted(
        glob.glob(os.path.join(downloads, "client_secret_*.json")),
        key=os.path.getmtime,
        reverse=True,
    )
    if not matches:
        sys.exit("No client_secret_*.json in Downloads. Pass the path as an argument.")
    return matches[0]


def load_creds(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    node = data.get("installed") or data.get("web")
    if not node:
        sys.exit("JSON is not an OAuth client file (no 'installed' or 'web' key).")
    if "web" in data and "installed" not in data:
        print(
            "Note: this is a Web-app client. It must list "
            f"{REDIRECT} under Authorized redirect URIs, or auth will fail.\n"
            "A Desktop-app client avoids that step."
        )
    return node["client_id"], node["client_secret"]


class Handler(http.server.BaseHTTPRequestHandler):
    code = None

    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        Handler.code = params.get("code", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        msg = "Authorised. You can close this tab and return to the terminal."
        if not Handler.code:
            msg = "No code received. Check the terminal."
        self.wfile.write(f"<html><body><h2>{msg}</h2></body></html>".encode())

    def log_message(self, *args):  # type: ignore[override]  # silence the access log
        pass


def get_code(client_id):
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    server = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    url = f"{AUTH_URL}?{query}"
    print("Opening your browser to authorise. Click Allow as your causalmap.app account.")
    if not webbrowser.open(url):
        print(f"Could not open a browser. Open this URL manually:\n{url}")
    while Handler.code is None:
        threading.Event().wait(0.2)
    server.server_close()
    return Handler.code


def exchange(client_id, client_secret, code):
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": REDIRECT,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = urllib.request.Request(TOKEN_URL, data=body)
    try:
        with urllib.request.urlopen(req) as resp:
            tokens = json.load(resp)
    except urllib.error.HTTPError as err:
        sys.exit(f"Token exchange failed ({err.code}): {err.read().decode()}")
    refresh = tokens.get("refresh_token")
    if not refresh:
        sys.exit("No refresh token returned. Re-run; the consent prompt must appear.")
    return refresh


def put_secret(name, value):
    proc = subprocess.run(
        f"npx wrangler secret put {name}",
        input=value,
        text=True,
        shell=True,
        cwd=MIST_DIR,
    )
    if proc.returncode != 0:
        sys.exit(f"wrangler failed setting {name}")
    print(f"  set {name}")


def main():
    path = find_client_json(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"Using client file: {path}")
    client_id, client_secret = load_creds(path)
    code = get_code(client_id)
    refresh = exchange(client_id, client_secret, code)
    print("Got a refresh token. Writing the three Worker secrets...")
    put_secret("GOOGLE_CLIENT_ID", client_id)
    put_secret("GOOGLE_CLIENT_SECRET", client_secret)
    put_secret("GOOGLE_REFRESH_TOKEN", refresh)
    print("Done. All three Drive secrets are set from one matched client.")


if __name__ == "__main__":
    main()
