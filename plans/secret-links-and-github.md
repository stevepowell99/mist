# Plan: secret links, then GitHub files and folders

Status: draft for review, 10 June 2026. Items c (auto-delete removal), d (centred layout) and e (preview button at top of sidebar) are already done and deployed; this plan covers the two remaining wants.

## Phase 1: secret capability links (DONE 10 June 2026)

Implemented as designed below and deployed. Keys live in the Durable Object; the loader and WebSocket upgrade both validate `?k=`; bare or wrong-key URLs 404. Suggest-role UI hides the mode toggle and accept/reject actions and locks the editor to suggest mode. `POST /new` and the home-page buttons return the edit link. Verified live: bare/wrong key 404, edit key 200, suggest link locked.

Goal: only people holding a link can open a document. Two link types per document:

- **Edit link** `/docs/:id?k=<editKey>`: full editing. The holder can switch between Edit and Suggest modes in the UI.
- **Suggest link** `/docs/:id?k=<suggestKey>`: locked to Suggest mode plus comments. The mode toggle is hidden; the holder can never switch to Edit. An edit-link holder can always do everything a suggest-link holder can.

Design:

- On document creation, `DocumentAgent` generates two random keys (24 chars, `crypto.getRandomValues`) and stores them in `doc_state` (`editKey`, `suggestKey`).
- The route loader and the WebSocket upgrade both validate `k` against the Durable Object. No key or a wrong key returns 404, so document ids alone reveal nothing.
- The validated role (`edit` or `suggest`) is attached to the WebSocket connection and returned to the client, which locks the UI accordingly (hide ModeToggle for the suggest role, force `mode: "suggest"`).
- The Share menu offers both links (copy edit link, copy suggest link).
- `POST /new` returns the document URL with the edit key appended; the curl flow keeps working.

Known limitation: Yjs updates are opaque binary, so the server cannot cheaply distinguish a suggestion update from a direct edit. The suggest lock is enforced in the client; the server enforces only who can connect at all. For invited reviewers this is acceptable; revisit if links ever go to untrusted audiences.

Open point: `POST /new` itself stays public at first (anyone could create docs on the worker, but not see ours). Optionally gate it later with a single admin key stored as a Worker secret.

Migration: existing documents have no keys. On first GET after deploy, the agent generates keys for legacy docs; old bare URLs stop working (acceptable: only test docs exist).

## Phase 2: GitHub single file

Goal: import one markdown file from a repo on Steve's account, review it in mist, commit the result back.

- Fine-grained PAT (contents read/write, selected repos only) stored with `wrangler secret put GITHUB_TOKEN`. Server-side only; it never reaches the client.
- New route `POST /gh/import` (gated by an admin key, also a Worker secret): body `owner/repo/branch/path`. It fetches the file via the GitHub contents API, creates a document seeded with it, stores `{owner, repo, branch, path, sha}` in `doc_state`, and returns the edit link.
- "Commit to GitHub" action (visible to edit-link holders on GitHub-backed docs): serialises the document with the existing CriticMarkup serialiser and PUTs it back with the stored `sha`. A `sha` mismatch (file changed upstream) returns a clear error instead of overwriting.

## Phase 3: folder of files, navigation, images

- Import a folder: list `*.md` in the GitHub directory and create one document per file under a shared collection id; one pair of secret links covers the whole collection.
- A file-list sidebar (or header dropdown) navigates between the collection's documents; relative `[links](other-file.md)` rewrite to the sibling document URL with the same key.
- Images: a proxy route `/gh-assets/:collection/*` fetches images from the repo via the PAT and serves them with caching headers. Relative image paths in markdown resolve against the proxy, so private-repo images display in Preview. (The TipTap editor itself still shows raw `![]()` syntax; images render in Preview, which is fine for review.)

## Order and why

Secret links come first because nothing private can be shared until access is gated. GitHub single-file is the core workflow (import, review, commit back). Folders and images extend it. The `npm audit` review (roadmap item 5) stays before any wider sharing of links.
