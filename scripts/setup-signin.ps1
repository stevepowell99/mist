# Sets up Google sign-in for mist in one run.
#
# Google keeps OAuth *client* creation in the Console (no CLI for it), so this
# script collapses everything around that single action: it opens the right
# page, tells you exactly what to paste, then takes the new client ID and sets
# both Worker secrets (generating the session secret itself, so it never appears
# on screen or in history).
#
# Run from anywhere:  pwsh -File scripts/setup-signin.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
  $origin = "https://mist.broad-smoke-cc64.workers.dev"
  $account = "hello@causalmap.app"
  $credUrl = "https://console.cloud.google.com/apis/credentials?authuser=$account"

  Write-Host ""
  Write-Host "mist Google sign-in setup" -ForegroundColor Cyan
  Write-Host "-------------------------"
  Write-Host "Create a NEW OAuth client (separate from the relay's Desktop client):"
  Write-Host ""
  Write-Host "  1. The Credentials page is opening in your browser."
  Write-Host "     Pick the same project your mist relay uses."
  Write-Host "  2. Create credentials  ->  OAuth client ID  ->  Application type: Web application"
  Write-Host "  3. Name:                      mist sign-in"
  Write-Host "  4. Authorised JavaScript origins, add:"
  Write-Host "         $origin"
  Write-Host "         http://localhost:5173            (only if you want sign-in on dev)"
  Write-Host "     Leave 'Authorised redirect URIs' empty."
  Write-Host "  5. Create, then copy the Client ID (ends in .apps.googleusercontent.com)."
  Write-Host ""
  Write-Host "  Consent screen: make sure colleagues can sign in (add them as Test users,"
  Write-Host "  or Publish; openid/email are non-sensitive, so no verification is needed)."
  Write-Host ""

  Start-Process $credUrl | Out-Null

  $clientId = (Read-Host "Paste the new Web client ID").Trim()
  if ($clientId -notmatch '\.apps\.googleusercontent\.com$') {
    throw "That does not look like a client ID (should end in .apps.googleusercontent.com)."
  }

  Write-Host ""
  Write-Host "Setting GOOGLE_SIGNIN_CLIENT_ID ..." -ForegroundColor Cyan
  $clientId | npx wrangler secret put GOOGLE_SIGNIN_CLIENT_ID
  if ($LASTEXITCODE -ne 0) { throw "wrangler secret put GOOGLE_SIGNIN_CLIENT_ID failed." }

  Write-Host ""
  Write-Host "Generating and setting SESSION_SECRET ..." -ForegroundColor Cyan
  $sessionSecret = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  $sessionSecret | npx wrangler secret put SESSION_SECRET
  if ($LASTEXITCODE -ne 0) { throw "wrangler secret put SESSION_SECRET failed." }

  Write-Host ""
  Write-Host "Done. Reload the mist home page; the Google button should appear." -ForegroundColor Green
  Write-Host "Sign in, then opening a Drive file checks that file's sharing for your email."
}
finally {
  Pop-Location
}
