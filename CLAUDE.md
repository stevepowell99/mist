# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gmist: an independent app (formerly a mist fork)

gmist is Causal Map's internal editor for collaborative markdown documents and slides: like Google Docs, but for `.md` files, with files and permissions coming from Google Drive. The aim is that a file edited locally one day and in gmist the next is the same file, equally and seamlessly. Synchronous multi-user editing is not a goal.

It began as a fork of [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (Matt Webb's collaborative markdown editor) but has diverged completely (~160 commits ahead, Drive-only, a new CodeMirror 6 / Y.Text core) and no longer tracks upstream. The mist origin is history only: the `upstream` remote has been removed, there is nothing to merge, and the rest of this file is gmist's own guidance. Treat "based on mist" as irrelevant to current work.

- **Naming.** The product is "gmist". User-facing copy was renamed to gmist on 17 June 2026 (the single `APP_NAME` constant in `app/shared/constants.ts` drives the wordmark and tab titles; a few prose strings and the Obsidian review banner say gmist too). The structural identifiers stay `mist` on purpose: the worker name (`mist` in `wrangler.jsonc`, which fixes the live URL `mist.broad-smoke-cc64.workers.dev`) and the `mist:` document frontmatter key. Renaming the worker would break every existing shared secret link; renaming the frontmatter key would orphan saved comment threads. Revisit only if gmist moves to a custom domain, and then with a redirect and a frontmatter read-both/write-new shim.
- Remote: `origin` = `stevepowell99/mist`.
- Purpose: share a markdown file or folder from Google Drive with collaborators via a secret link, for async review with CriticMarkup suggestions and comments. Collaborators need no account; they sign in only to pass the file's Drive ACL. Separate from the Qualia apps.
- The old local "slides app" in the `19c-slides` folder is being deprecated and removed; gmist has its own independent slides implementation (`app/lib/slides-build.ts`) and depends on nothing in that folder.
- Global guidance: read `C:\Users\Zoom\.claude\CLAUDE.md`. This project is registered in its Project Index.
- Editor: Claude Code.
- **Always deploy to remote after changes** (`npm run deploy`) so Steve can test on the live worker, then give him the URL. The dev server has cold-start flakiness on first open of a fresh room; the deployed worker does not, so remote is the source of truth for verification.
- **Commit in focused chunks.** This is a solo project that deploys from `main`, so commit directly to `main` (no PR/branch workflow needed), one concern per commit, once the change typechecks. `npm run deploy` does NOT commit (it only uploads to Cloudflare), so commit separately. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **One agent at a time on this working tree.** If two Claude sessions edit here at once they share one working tree: their edits interleave in the same files, either one's `git commit` bundles both sets of changes, and either one's `npm run deploy` ships the other's in-progress code. Run one at a time, or give each session its own `git worktree`.

### Current state (14 June 2026). READ THIS FIRST.

mist is now **Google Drive only, with all GitHub code removed** (see the 16 June note below; the older "GitHub writing disabled" state is superseded), after a corruption incident where auto-commit-on-open wrote one document's content into another file and double-synced (it committed via the GitHub API to files that also live in Drive). Full incident report, the recovery (garden `content/` is a separate nested git repo recovered to baseline `4d9a2d4`), the safety model, the long Drive-era feature list, and the remaining work are in **`plans/live-collab.md`** ("CORRUPTION INCIDENT and current safety model", at the top). The document model must round-trip faithfully through Drive; the current auto-save and conflict-safety model that replaced the old hazard is in the 16 June note below.

**Auth (15 June 2026):** the shared passphrase is retired. Access to `/drive/*` is Google sign-in (session cookie) plus the file's own Drive sharing (per-file ACL); the sandboxed slides iframe uses a short-lived signed asset token. The `DRIVE_ACCESS_KEY` secret is unused and can be deleted (`wrangler secret delete DRIVE_ACCESS_KEY`). Drive itself is accessed through ONE relay identity (a single Google account's `GOOGLE_REFRESH_TOKEN`), not per-user OAuth: collaborators sign in only to pass the per-file ACL and edit files in the relay's Drive. Per-user "connect your own Drive" would be a multi-tenant rebuild (per-user token storage + Google verification for the restricted `drive` scope; `drive.file`+Picker avoids verification but only sees picked files).

**OAuth consent screen mode (Google Cloud project 402686357169, hello@causalmap.app):** while the consent screen is in **Testing**, refresh tokens expire after 7 days, so the relay breaks weekly. Fix once: set User type to **Internal** (if causalmap.app is a Workspace domain: no verification, tokens never expire, but only causalmap.app accounts) or **Publish app** to Production (tokens stop expiring; an "unverified app" warning until verified). Mint `GOOGLE_REFRESH_TOKEN` AFTER changing this, or the token is still on the 7-day clock. The relay OAuth client is `…ck5m0fhfg…`; the browser sign-in client is `…1d50288j…`; both share the project's one consent screen.

**Cloudflare cost (15 June 2026):** on the Workers free tier, Durable Objects bill "duration" for the wall-clock time the DO is active, and an open WebSocket keeps it active. A day with mist tabs left open can hit the daily DO duration cap (resets 00:00 UTC). Mitigation shipped: idle auto-close (`useYjsEditor`) drops the socket after 10 min idle or hidden (relaxed from 5 min / 45s on 18 June so a briefly-backgrounded tab is not dropped under a presenter), so the DO goes cold. The real escape hatch is the $5/month Workers Paid plan (far higher DO limits); Steve has not upgraded yet.

**Drive conflict-safety and GitHub removal (16 June 2026):**

- **Guiding principle (decided 18 June 2026): content is the source of truth; a Drive `headRevisionId` is only a hint and a timestamp is decoration.** Every sync boundary must decide "did it change?" by comparing the body (`stripFrontmatter`), never by a revision id or `modifiedTime` equality. The only id/time uses left are the conditional-write token (backstopped by a content recheck) and one safe shortcut (equal id ⇒ unchanged); `modifiedTime` is display-only. Do not reintroduce version- or time-based "newer" logic. And do NOT propose making gmist Drive-API-only to dodge the multi-writer churn: the whole point of choosing Drive is that the file is also a real local/Obsidian file (the "edit locally one day, in gmist the next" promise), so API-only would mean Drive buys nothing over R2/D1. The multi-writer setup (gmist API + Drive for Desktop) is acceptable precisely because reconciliation is content-based; the residual revision churn self-heals (see the false-conflict recovery below).
- GitHub is gone entirely: import, commit-back, `GitHubBackend`, the `github.ts`/`github.server.ts` modules, the `gh/import` route, `GITHUB_TOKEN` and `ADMIN_KEY` are all removed. Drive is the only backend, and the `DocBackend` abstraction now has one real implementation.
- Auto-save is ON (debounced ~2.5s) and conflict-safe. The relay never silently overwrites the editor. The decision is content-based, not time-based: Drive's `headRevisionId` cannot order revisions, and a re-upload stamps a new id on old content, so timestamps cannot be trusted. In `agents/document.ts` `checkUpstream`: on every connect it re-reads Drive and, when nothing is unsaved here and Drive's body differs, ADOPTS Drive (Drive is the source of truth on a clean reopen); unsaved edits and Drive diverged keeps the editor, forks the incoming Drive copy to a `… (drive copy …)` sibling, and saves yours to the main file; an explicit reload first snapshots the editor to a `… (gmist unsaved …)` sibling, so it can never lose work.
- **The comparison is BODY-only (18 June 2026 fix).** The editor's `Y.Text` body is frontmatter-stripped (threads live in a Yjs map), but a save runs `serializeThreads`, which YAML-reformats the whole frontmatter and re-adds the `mist:` block whenever the doc has comments. So a saved file always differs from the editor text in the frontmatter even when the body is untouched. `checkUpstream` therefore compares `stripFrontmatter(local)` vs `stripFrontmatter(base)`/`stripFrontmatter(drive)`: the body is the real "did it change" signal. Comparing whole files (the old bug) made every external edit look like a local edit, so it forked the change aside instead of adopting it (the stray "drive copy" siblings). Adopt re-seeds the editor as `serializeThreads(driveBody, [], driveFrontmatter)` so the `mist:` YAML never leaks into the body.
- **False-conflict recovery on save (18 June 2026).** The conditional write compares Drive's `headRevisionId` to the version we last saw; a mismatch throws "changed upstream". But Drive for Desktop re-uploads our own save and stamps a NEW revision id on identical content, so with nobody editing the next save was falsely rejected and auto-save latched into "conflict". Now on that error `doCommit` re-reads Drive and compares the BODY against our last save (`lastCommitMd`): if equal it is our own content re-stamped (a re-upload churn), so it re-anchors to the new version and writes the pending content (one retry); only a genuine body divergence stays a conflict. Logged as `save … (recovered from a re-upload churn)` vs `save-conflict`.
- **No phantom "Saving" on open (18 June 2026 fix).** The unsaved badge must baseline against the editor's OWN serialization, never the relay's stored file bytes. For a commented doc the two never match: the editor body has no `mist:` block (threads in a Yjs map), `serializeThreads` re-emits and YAML-reformats the frontmatter, threads serialize in document-position order while the file stores another order, and `useTextThreads` can auto-create thread metadata with fresh ids/timestamps on load. So the old "authoritative committed hash on connect" (`quickHash(lastCommitMd)`) was structurally unequal to the client's `currentHash`, writing one save on every open. Now `DocumentContext` baselines `lastCommittedHash` to its own `currentHash` and keeps re-baselining through the post-sync settle (body, `threads` map and legacy `meta` map land on separate ticks), then FREEZES on the user's first real edit. Crucially the `unsaved` badge is also GATED on a `userEdited` flag, so a freshly loaded file reads "Synced" with no flash even before the baseline settles (a load is in sync by definition; only an actual edit can make it unsaved). A real edit is a CodeMirror `userEvent` transaction (not a remote Yjs sync update; `CodeMirrorEditor` `onUserEdit`) plus the comment/reply/resolve/delete actions (`markUserEdited` sets the ref the effect reads and the state the badge reads). The agent sends NO connect-time `committed`; it only confirms a hash after an actual save (`doCommit`), which matches because the relay writes exactly the client's pending serialization.
- **Diagnostic sync trail (18 June 2026).** The agent records each sync decision (`open`, `adopt-drive`, `conflict-fork`, `save`, `save-conflict`, `upstream-error`) into a `sync_log` SQLite table (pruned to the last 200), exposed via the agent's `?synclog` GET. The `/drive/docinfo` route returns that log plus richer Drive metadata (modified time, owner, last editor, size, link) for the open file, and the Drive sidebar (`FolderSidebar`) shows a file-details block with a collapsible "Sync activity" trail. First stop when sync looks wrong.
- Root cause it guards against: a file in a folder that Google Drive for Desktop syncs has TWO writers, the relay through the Drive API and Drive for Desktop pushing the laptop's local copy. When the local copy is stale and Desktop pushes it, it overwrites the relay's newer content under a fresh revision id. Keep one live writer per file: do not edit a gmist file in the app while Drive for Desktop is live-syncing that same file on a machine.

**Access control (17 June 2026):** opening AND editing a Drive-bound doc now requires a signed-in user the file's own Drive sharing grants, not just the secret link. The hard gate is the agent WebSocket in `workers/app.ts` (it rejects an unauthorised upgrade); the loader shows a sign-in / no-access screen; one `authorizeDoc()` in `drive-access.server.ts` is the shared decision (effective role = the more restrictive of the link role and the Drive role). Access via a Google Group is not resolved (same limit as `drive.import`).

**Slide/image library (17 June 2026):** a reusable gallery (`/library` slash or the header grid button) drops a standard slide fragment or image into a deck from one curated Drive folder. Set the folder in the `DEFAULT_LIBRARY_FOLDER_ID` constant in `app/lib/library.server.ts` (it is a folder id, not a secret, so it lives in the repo; the `LIBRARY_FOLDER_ID` env var optionally overrides it per deployment). The folder holds `slides/` (`.md` fragments) and `images/` subfolders. Library images are inserted as `![](drive:<fileId>)`, a portable by-id reference resolved at render time; tradeoff: a `drive:<id>` reference shows nothing in a plain markdown viewer (Obsidian/local), which is fine because a shared-library image has no portable local path. Deck-relative pasted images still use relative paths and stay locally viewable. The gallery has multi-select (a checkbox per result, select-all/none, insert several at once), an Images-tab upload into the library's `images/` folder (`drive.library-upload.ts`), and rewrites a picked deck's relative images to `drive:<id>` at pick time so a borrowed slide's pictures still resolve (`drive.resolve.ts`); a library image inserts wrapped in a `::: {.scale-75}` block so it is easy to resize. Plan and remaining phases: `plans/slide-image-library.md`.

**Maintainability refactor (17 June 2026): where shared logic lives now, so it is reused, not re-duplicated.** The composable-grammar pipeline is ONE function, `applyGrammar` in `app/lib/slides-build.ts` (mask code, bignums, optional wikilinks, callouts/spans/images/divs, restore); the slide builder, the document `Preview` and the library thumbnails all call it (do not re-inline the converter chain). The deck's in-iframe runtime is `deckRuntimeScript` in `app/lib/slides-runtime.ts` (slides-build.ts is now just the HTML-shell assembler). Every `/drive/*` route opens with `openDriveRequest()` (session + Drive-configured gate) and uses the shared `json()` (`app/lib/http.server.ts`) and mime tables (`app/lib/mime.ts`); do not redefine these per route. The `docs.$id` route's keyboard and split-gutter logic are the `useChordListener` / `useSplitDrag` hooks. The picker ranking helper is `searchScore` in `app/lib/fuzzy.ts` (a direct name hit always outranks a description hit), shared by the `.`-class and `/`-slash menus. `classes.json` is the single catalogue. The hand-written appearance axes (component/colour/fill/border/theme/shade/align) keep their look in `deck-base.css`; the stepped numeric axes (`scale`, `opacity`, `width`, `height`, `place` coords) are GENERATED from `classes.json` into a marked region of `deck-base.css` by `scripts/gen-styles.mjs` (`npm run gen:styles`; `--check` for CI). `fade` is hand-written (a `color-mix` template, not a plain step). The test `tests/unit/styles/classes-css-sync.test.ts` guards both: a catalogued appearance class with no selector fails, and a stale GENERATED region (not matching the manifest) fails. So edit a step list in `classes.json` then run `npm run gen:styles`; never hand-edit between the GENERATED markers.

**Slides grammar / theming simplification (19 June 2026). A theme is now just variables.** Two follow-on simplifications, both about "one truth, not two":
- **One mechanism for the slide canvas.** The deck canvas (`.reveal-viewport` / `.reveal` background+text) is set ONCE in the deck shell (`PREVIEW_CSS` in `slides-build.ts`) from `--slide-bg` / `--ink`. A theme NO LONGER restates those; it only sets the variables (`--slide-bg`, `--ink`, `--accent`, `--accent-2`, optional `--divider-bg`, a `font-family` on the `:is(.reveal,.preview)` block) plus its accent/component overrides. To restyle a DOCUMENT preview too, a theme adds a `.preview { background; color }` line (causal-map deliberately omits it, so an un-themed doc keeps its serif look). `causal-map.css`'s header is the reference for writing a theme.
- **One mechanism for colouring a whole slide = reveal's full-viewport background.** A divider (lone `#`) or `.title-page` slide with no background of its own gets `data-background-color: var(--divider-bg, var(--slide-bg))` emitted by `parseHeading`, so the colour fills the slide AND the letterbox, seamless. Themes that want dark dividers just set `--divider-bg` (causal-map, qualia, blackboard, moonshot). The old approach (painting the `section` element) only covered the 16:9 area and left light letterbox gutters; it and the whole `has-slide-bg` class + `:not(.has-slide-bg)` gate are GONE. Do not reintroduce a `background` on a divider/title section.
- **Friendly aliases compose standard classes.** `CLASS_ALIAS` in `slides-build.ts` expands a friendly name to a bundle of standard utility classes at parse time, so it carries no bespoke CSS and every axis utility overrides it (the normal cascade). `.caption-bar` (and back-compat `.shot-cap`) = `.bg-ink .left-0 .right-0 .bottom-0 .footer`. Add new sugar there, not as new CSS.
- **`.fade-*` is fill-opacity** (translucent BACKGROUND only, text stays opaque) for a box over an image; `.opacity-*` fades the whole element. `.fade-*` uses `color-mix` + `!important` and is hand-written (not generated).
- **Override recipe:** a component that wants overridable defaults declares them in `:where(...)` (zero specificity) so utilities always win.

**Split-view cursor/slide sync (17 June 2026).** In split view the editor and the deck preview track each other in both directions, and the editor is the higher-priority side. Forward (editor drives deck): as the cursor moves, the deck jumps to the cursor's slide (`SlidesView`, gated by the "Follow cursor in slides" toggle). Reverse (deck drives editor): as you navigate the deck (its arrow keys, clicking a slide), the editor cursor follows to that slide's heading WITHOUT taking focus, skipped while the editor is focused so typing always wins and the cursor is never yanked mid-edit (`docs.$id` `followDeckInEditorRef`, gated by the "Follow slide in editor" toggle). It is a stable fixed point, not a loop: the cursor lands on the slide's own heading, which forward-maps back to the same slide. The manual reverse jump (the gutter button and Ctrl/Cmd+Alt+G) instead pulls focus, for jump-and-edit. Both toggles live in the RHS settings foot and persist per file in `DocSettings` (`followCursor`, `followSlide`).

**Deck image default (17 June 2026).** Deck images are capped to the slide by default (`max-width:100%` + a height cap in `deck-base.css`); a `.scale-*` wrapper or explicit `width=`/`height=` overrides. This restores a cap that was lost when the house framework replaced reveal's themes (reveal's per-image `max-width` lived in those themes).

**One Present mode (18 June 2026).** There is a single in-app present path; reveal's own iframe fullscreen is no longer a separate "mode". The pivot: gmist fullscreens the WHOLE APP (`document.documentElement.requestFullscreen`), not the deck iframe, so the app's own presenter UI can sit beside/over the slide (fullscreening the iframe hid it, which forced the old `/slides` page and reveal F). In `docs.$id`: `presenting` state (a deck only), entered by the navbar Present button or Ctrl/Cmd+Alt+P; the chrome (header, asides, editor) is hidden and the deck fills the screen. Leaving browser fullscreen (Esc/F11) leaves Present via a `fullscreenchange` listener. The deck runtime (`slides-runtime.ts`) intercepts plain **F** while embedded (`window.parent !== window`) and posts `mist-present` to enter this mode instead of reveal's fullscreen; the standalone `/slides` page (not embedded) keeps reveal's native F. The **presenter card** (`PresenterRail`, floating at the right-middle) shows time-since-start, position (N/M), the next slide's top-left (zoomed up) and the current slide's `::: {.notes}` inline, so no separate notes window is needed; it reveals on hovering the right-edge zone or with Ctrl/Cmd+Alt+N and closes on mouse-leave. Ctrl/Cmd+Alt+D still opens the slide list (as a left overlay) while presenting. The next-slide thumbnail and notes parsing are the shared `app/lib/slide-thumb.ts` helpers (`slideThumbHtml`, `slideNotes`), also used by the library gallery. `/slides` still exists as a route (a shareable present link) but is no longer the primary path. **Printing (19 June 2026):** native Ctrl/Cmd+P on a deck CRASHES the browser (it tries to print the live sandboxed reveal iframe), so it is intercepted (the deck runtime forwards it from the iframe; `docs.$id` has a window handler) and routed to the `/slides?…&print-pdf&combine-fragments` page, the same target as the navbar "Print to PDF". The page opens in a new tab when there is a user gesture, else same-tab (a cross-frame `postMessage` from the iframe carries no gesture, so a popup would be blocked). The print page sets `<title>` to `<file>-<theme>-gmist-<YYYY-MM-DD>` so "Save as PDF" suggests a sensible filename.

**Known limitations / deferred simplifications (19 June 2026).**
- **Each open mints a NEW room.** `/drive/import` uses a random `generateDocumentId()`, so opening the same Drive file twice (e.g. Ctrl/Cmd-click a Drive-sidebar result for a new tab) makes two rooms both bound to that one file. Accepted for now; making import deterministic per `fileId` (reuse the room) is a deferred, larger change.
- **The save/dirty machinery is the next DRY target.** Its state is spread across `DocumentContext` (`currentHash`, `lastCommittedHash`, `userEdited`, `conflict`, `upstreamChanged`, `forkedNotice`) and `agents/document.ts`; it works and now carries a state-machine comment, but it is the place most likely to grow another "one truth, two representations" bug. Left as-is on purpose.

The roadmap below is the older upstream/GitHub-era history; treat `plans/live-collab.md` as the current truth.

### Roadmap

1. DONE 10 June 2026: deployed to Cloudflare Workers free tier at [mist.broad-smoke-cc64.workers.dev](https://mist.broad-smoke-cc64.workers.dev) (account `hello@causalmap.app`, auth via `npx wrangler login`, no `CLOUDFLARE_ACCOUNT_ID` needed). Verified: POST `/new` creates a document and the editor renders it with a live WebSocket connection. Redeploy with `npm run deploy`.
2. DONE 10 June 2026: removed the 99-hour expiry (alarm in `agents/document.ts`, TTL constants, header copy, demo and README copy, tests). Also centred the editor and preview columns and moved the Preview toggle to the top of the right sidebar.
3. DONE 10 June 2026: secret capability links. Each document has an `editKey` and a `suggestKey` (stored in the Durable Object). The URL carries `?k=<key>`; the loader and the WebSocket upgrade both validate it, so a bare or wrong-key URL 404s. An edit-link holder can switch to Suggest mode; a suggest-link holder is locked to suggest and never sees the mode toggle or accept/reject actions. The Share menu offers both links to edit-role users. `POST /new` returns the edit link. Suggest enforcement is client-side (Yjs updates are opaque to the server); the server gates who can connect. Also done same day: markdown tables (aligned monospace in the editor source, real bordered table in Preview), default line length 30% wider (91ch), default body font 20% larger (1.38rem).
4. DONE 10 June 2026 (single file): import a markdown file from a PUBLIC GitHub repo by pasting its URL on the home page, and commit the reviewed result back. Decided to use public repos only: reads need no auth and images are served straight from `raw.githubusercontent.com` (no proxy). Preview rewrites relative image URLs (markdown `![]()` and HTML `<img src>`) to raw URLs. Commit-back is the only path needing a fine-grained PAT (`GITHUB_TOKEN`, Contents: write), gated by `ADMIN_KEY` so only the admin can write, not edit-link holders; the admin key is stored in the browser and sent with the commit request. Both secrets are set with `wrangler secret put`. Still TODO under this item: folder import with file navigation between docs.
5. DONE 10 June 2026: automatic commit-back. Connected editors relay the serialized doc to the `DocumentAgent` over the socket; the agent commits to GitHub on a ~90s throttle AND via a durable alarm, so the final state commits even after the last editor disconnects (verified live: a disconnected doc committed ~90s later). A "Save to GitHub now" header indicator shows amber "Unsaved" until the commit lands then "Saved", clicking it commits immediately, and a `beforeunload` guard warns before closing with uncommitted edits. Any edit-role connection drives commits (the doc is already key-gated). This replaced the admin-key `/gh/commit` route, so `ADMIN_KEY` is now unused (the secret can be deleted). Images via inline preview in the editor too (markdown, HTML and Obsidian `![[...]]` embeds). The matching build-side change (the Garden build does a desktop.ini clean + `git pull` of `content/` before building, so it picks up web edits whenever it runs) is TODO in the Garden project. Roadmap design for the live-sync pivot is in `plans/live-collab.md` (Drive-default live collaboration, GitHub preserved; supersedes `plans/live-sync-obsidian.md`).
6. Bibliography: support a `My Library.bib` the way the Garden project does. DONE: Preview parses the repo's `.bib` (`app/lib/citations.ts`), converts Pandoc `[@key]`/bare `@key` citations to inline APA, and renders a reference list at the bottom. DONE 11 June 2026: `@`-citation picker in the editor (`app/lib/citation-suggest.ts` plus `app/components/CitationPopup.tsx`, driven by `@tiptap/suggestion`). Typing `@` brings up a searchable list of references (author, year, title) filtered as you type, and inserts bracketed `[@key]` text. Works in both edit and suggest mode; in suggest mode the inserted citation is wrapped in a `criticAddition` mark, like any other suggested edit. The library is fetched once for GitHub-backed docs (the same candidate paths Preview uses) and held on a controller the editor reads live, so the picker only offers references on docs whose repo contains a `.bib`. TODO: a way to supply a bib for non-GitHub docs (upload or paste).
7. Before sharing links widely, review `npm audit` (31 inherited vulnerabilities, 2 critical, as of 10 June 2026) and consider offering changes upstream as PRs where general.

### Local dev gotchas

- `npm run dev` serves at `http://localhost:5173`. On a cold Vite cache, the first open of a fresh room can fail to sync ("Outdated Optimize Dep" / a dynamic-import error) because the editor route lazy-loads CodeMirror/Yjs and Vite re-optimises mid-navigation. Hard-reload or open the doc a second time; deployed builds are unaffected.
- **Localhost is for occasional testing only, never for real work.** Real editing always happens on the deployed worker (the source of truth; see "Always deploy to remote after changes" above), so a file is the same whether opened locally elsewhere or in gmist. `npm run dev` runs the Worker AND the Durable Objects in workerd on this machine, so a test run consumes none of the account's DO duration (the free-tier limit that nearly tripped on 15 June 2026); that is a side benefit of testing locally, not a reason to do work there. Secrets come from `.dev.vars` (gitignored; template in `.dev.vars.example`): the `GOOGLE_*` values must match production (Cloudflare secrets are write-only, so reuse the originals), and `SESSION_SECRET` can be any local random string. For Google sign-in to work on localhost, add `http://localhost:5173` to the sign-in OAuth web client's Authorized JavaScript origins in the Google Cloud console. Collaboration is localhost-only; sharing links with others needs the deployed site.
- Scratch work goes in `_tmp/` (gitignored locally); Playwright here is the Python package, not the npm one.
- **The editor is the CodeMirror 6 / Y.Text core (#13).** The CRDT is a single `Y.Text` of raw markdown (`doc.getText("body")`), bound to CodeMirror via `y-codemirror.next`; save is `ytext.toString()`, an identity. CriticMarkup is literal delimiter text styled by decorations (`cm-criticmarkup.ts`), suggest mode rewrites edits into CriticMarkup (`cm-suggest.ts`), comments are `{>>..<<}`/`{==..==}` text matched to the Yjs `threads` map by content (`cm-comments.ts`, `useTextThreads.ts`), and the `@`-picker is a CM autocomplete (`cm-citations.ts`). The old TipTap/ProseMirror stack was deleted; do not reintroduce marks or a node model. Design notes in `plans/ytext-core.md`.

## Start of Session

Read project documents to load context:

- `docs/design-system.md` — visual design, typography, colours, layout
- `docs/technical-architecture.md` — platform, framework stack, directory structure, critical rules

Also check `plans/` for any active plan.

## Project Overview

gmist is a collaborative markdown and slides editor for Google Drive files, like Google Docs but for `.md`/`.qmd`. A file is shared by a secret link; collaborators sign in only to pass the file's Drive ACL and can edit or suggest (CriticMarkup). Live awareness (multiplayer presence) is supported; simultaneous multi-user editing is not a goal. Drive is the single source of truth; edits auto-save back to the file (conflict-safe, see the 16 June note above).

## Tech Stack

- **Backend:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Frontend:** React Router 7 (SSR) + Cloudflare Agents SDK
- **Editor:** CodeMirror 6 + Y.Text (CRDT, via `y-codemirror.next`)
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest with v8 coverage

## Prerequisites

Requires Node.js 22+ (see `.nvmrc`). Before running commands:

```bash
source ~/.nvm/nvm.sh && nvm use
```

## Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers
npm run typecheck    # Full TypeScript type checking (runs cf-typegen + react-router typegen + tsc)
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run test:watch   # Vitest in watch mode
npm run cf-typegen   # Generate Cloudflare Worker types

# Run a single test file
npx vitest run tests/unit/lib/critic-parser.test.ts

# Run tests matching a pattern
npx vitest run -t "pattern"
```

## Architecture

See `docs/technical-architecture.md` for full details.

### Directory Layout

- `agents/` — Server-side Durable Object agents (currently just `DocumentAgent`)
- `app/components/` — React UI components
- `app/lib/` — Editor logic, CriticMarkup, Yjs provider, utilities
- `app/shared/` — Constants and types shared between client and server
- `app/routes/` — File-based routing (`home.tsx`, `docs.$id.tsx`, `new.ts`)
- `workers/app.ts` — Cloudflare Worker entry point
- `tests/` — Unit tests (`tests/unit/`) and integration tests (`tests/integration/`)

### Import Path Alias

`~` resolves to `app/` (configured in tsconfig and vitest). Use `~/lib/foo` instead of relative paths.

### Critical Rule: Server/Client Separation

Client-side React components must **never** import from `agents/`. The `agents` package uses `cloudflare:` protocol imports that don't exist in the browser. Use `app/shared/` for types needed by both sides.

### Real-Time Collaboration Flow

The multiplayer system works as follows:

1. **`DocumentAgent`** (`agents/document.ts`) — a Durable Object that holds a Yjs `Y.Doc` in memory, persists state to SQLite on every update, and relays Yjs sync/awareness messages between connected WebSocket clients.
2. **`yjs-provider.ts`** (`app/lib/`) — client-side WebSocket provider that connects to the agent at `/agents/document-agent/:docId` and handles Yjs sync protocol encoding/decoding.
3. **CodeMirror 6** binds to the Yjs `Y.Text` body (`doc.getText("body")`) through `y-codemirror.next`, which also renders remote cursors from the awareness protocol.
4. **Worker entry** (`workers/app.ts`) — `routeAgentRequest()` intercepts `/agents/:agent/:name` requests before React Router handles the rest.

### CriticMarkup / Suggest Mode

Track-changes is plain CriticMarkup delimiter TEXT in the single `Y.Text` body, styled by CodeMirror decorations, not a mark or node model. The canonical description is the CodeMirror 6 / Y.Text core bullet under "Local dev gotchas" above, with design notes in `plans/ytext-core.md`. Key files:

- `app/lib/cm-criticmarkup.ts`: decorations that style the `{++ ++}`/`{-- --}`/`{== ==}`/`{>> <<}` delimiters
- `app/lib/cm-suggest.ts`: suggest mode, rewriting edits into CriticMarkup additions and deletions
- `app/lib/cm-comments.ts` and `app/lib/useTextThreads.ts`: comments matched to the Yjs `threads` map by content
- `app/lib/critic-parser.ts`: parses CriticMarkup syntax into clean text and ranges

### Testing Constraints

- The `agents` package uses `cloudflare:` imports — it **cannot** be imported in plain Vitest. Test agent logic through integration tests or mock the imports. Unit tests should focus on pure logic in `app/lib/` and `app/shared/`.
- Coverage thresholds ramp linearly from 0% to 80% between Feb–Dec 2026 (see `vitest.config.ts`).
- Tests live in `tests/unit/` and `tests/integration/`, mirroring the source structure.

### ESLint Conventions

- Unused variables must be prefixed with `_` (e.g., `_args`, `_ctx`).
- Tagged template expressions are allowed (for `this.sql` in Durable Objects).
