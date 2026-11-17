---
name: gmist-live-test
description: Test a gmist change on the deployed worker in a real browser, as a signed-in user or as a visitor with no sign-in, and check what reached the Drive file. Use when Steve says "test it live", "test it in the browser", "is it ready for colleagues", "try it as an anonymous visitor", "check sharing works", "test the share link", or after a deploy that touches access, saving, comments or suggestions.
---

# gmist-live-test

For Claude, working in `C:\dev\mist`. The deployed worker is the place to verify (project `CLAUDE.md`, "Workflow"); this is the routine for doing it with a throwaway file.

## Before testing

- **Deploy in the foreground**: `npm run deploy` with a 10-minute timeout. The build and the local gmist restart together can pass 10 minutes; when the command is moved to the background, wait for its notification.
  - "It's necessary to set a CLOUDFLARE_API_TOKEN" means wrangler has lost its login. Steve runs `! npx wrangler login` and clicks Allow at once; the callback is `localhost:8976`, which only answers while that command is waiting. Never start a second login beside his: the two clash on the port.
- **Confirm the build is the one serving**: grep `build/client/assets/*.js` for a string the change added, then `curl` that asset from the live site and count the match. A server-only change has no client string; add one to the Help text or check behaviour.

## The throwaway file

- Create a `.md` with `create_file` in the gmist examples folder (the parent of `gmist-examples-deck.md`; never the Drive root, never the two example files).
- Share it with `share_file`, `permissionId: "anyoneWithLink"`. **The connector only raises a role**, so test in the order unshared, `commenter`, `writer`.
- Trash it with `trash_file` when the test is over, and say so.

## Getting a room

- A room for a Drive file is minted by `/open?file=<fileId>`, which needs a signed-in gmist session.
  - The bot cookie (`scripts/.gmist-session` or `$GMIST_SESSION`) is often absent.
  - Otherwise use Steve's Chrome: he clicks "Sign in with Google" in the Claude tab group. Add `&cc=1` to the URL (a duplicate-tab extension closes a tab on a URL he already has open).
- **The Chrome tool hides query strings, so the room key never reaches Claude.** Keep the link inside that tab:
  - become a visitor with `await fetch('/auth/logout', {method: 'POST'})`, then reload;
  - sign-in afterwards is Steve's click again, so tell him his Chrome is signed out of gmist.
- An unbound room needs no sign-in: the home page's "New blank document". Python Playwright can drive one end to end, and can see the key.

## Reading state

- **Status badge and text**: `document.body.innerText.slice(0, 60)` for Synced / Saving / Suggesting / Editing; `[...document.querySelectorAll('.cm-line')].map(l => l.textContent).join('\n')` for the editor text.
- **Autosave waits 20 seconds after the last keystroke** (`AUTOSAVE_DEBOUNCE_MS`). "Saving…" for 20 seconds is a queued save. Wait 26 seconds before reading Drive.
- **What reached Drive**: `read_file_content` on the file id. The connector re-renders markdown, so trust it for words and markup, not for line breaks or escaping.
- **The agent's own view**, fetched by the page so the key stays in the tab:
  - `/agents/document-agent/<id>?source=1&k=<key>` returns the room text;
  - `/agents/document-agent/<id>?synclog=1&k=<key>` returns the sync log. The agent changes the body only on `adopt-drive`, which it always logs.
- **A fresh visitor**: remove `localStorage['mist-user']` to see the name prompt. Save the old value first and put it back at the end.

## Finding what changed the text

- The javascript tool runs in an isolated world: it cannot see the editor object. Inject a `<script>` element to run in the page, and pass results back through `document.documentElement.dataset`.
- The editor is `document.querySelector('.cm-content').cmTile.view`. Wrap `view.dispatch` to log each change with `new Error().stack`.
- To see who caused a click, add capture-phase listeners for `click`, `mousedown` and `keydown` and log `isTrusted`, the coordinates and the target. A click with `isTrusted` false and coordinates 0,0 that bypasses a patched `HTMLElement.prototype.click` came from a browser extension.
- **Steve's Chrome has extensions; headless Playwright has none.** A fault seen in only one of the two is not yet a gmist fault or an extension fault: reproduce it in the other before reading code.

## What to check for a sharing or editing change

- Unshared file, visitor: the sign-in screen, and a direct WebSocket to `/agents/document-agent/<id>?k=<key>` is refused.
- Commenter: opens in Suggesting; a typed suggestion and a comment reach Drive; a reply is saved under the visitor's name.
- Editor: opens in Editing; an edit reaches Drive; a pending suggestion survives a reload; a real click on Accept applies it.
- Reload after each save and read the text again: a loss that appears only after a reload is the commonest kind.

## Report

- Say what was seen working, what failed, and what was not tested (other browsers, phones, signed-in users), each on its own line.
- Leave behind: the file trashed, Steve's `mist-user` restored, tabs Claude opened closed, and any rooms created named.
