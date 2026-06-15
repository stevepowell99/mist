# Plan: live collaboration on a shared Drive folder (Drive default, GitHub preserved)

Status: design agreed in discussion, 12 June 2026. Supersedes `live-sync-obsidian.md` (which proposed a background desktop sync agent; we rejected that, see below). Builds on the shipped work in `secret-links-and-github.md`. No code until the build order here is agreed.

## Goal

Steve and a colleague collaborate on the markdown files in a shared Google Drive folder: live cursors, live preview, per-user edit or suggest, from a web link. The files stay in Drive as the single source of truth, edited by Obsidian or any other text editor the rest of the time and kept in sync by Drive as now. Nothing runs in the background on anyone's desktop. Access follows Drive permissions, with a secret link as a fallback for outsiders. GitHub stays available as a second backend, but Drive is the default for about 90% of use.

## Decisions taken (departures from the old plan)

- **Cloud bridge, not a desktop agent.** The old plan bound a local file to the relay with a background Node process. That breaks the moment the machine is off (Steve on holiday, colleague wants to edit). Instead the always-on relay reads and writes the Drive file directly through the Drive API. Holiday-proof, and it matches the machine-independence rule rather than fighting it.
- **Drive is the default backend; GitHub is preserved as a second one.** The import and commit-back GitHub mechanism already built stays, behind the same editor and links. No immediate need, but kept.
- **Plain-text document core.** Move the CRDT from a ProseMirror `XmlFragment` with marks to a single `Y.Text` of markdown plus inline CriticMarkup. This is what makes the bridge's text-diff-to-CRDT merge tractable, and it serves both backends, since each one just persists markdown text.
- **Auth by Drive permission, secret link as fallback.** Google sign-in (email only), and the relay checks that email against the file or folder's Drive sharing list. Secret links remain a single-file capability for people not in the Drive ACL.
- **Folder sidebar on the signed-in path only.** Drive gives siblings and parent for free, and folder access inherits, so one folder share unlocks navigation. Secret-link holders stay scoped to their one file.
- **Idle auto-close.** Sessions close after inactivity, flushing final state; the page shows a read-only banner with a Resume button. This sits on top of the merge guard, it does not replace it.

## Why build it rather than use an existing tool

Assessed June 2026. Peerdraft (GPL, has a web link and cursors, but persistence is paid, no self-host, and no suggesting) and Relay (MIT, self-hostable, but Obsidian-only with no web editor and no suggesting). Neither does suggesting and neither fits the Drive-permission model, so we build the web half on mist's own MIT backend.

## Architecture (layers)

1. **Document core.** One `Y.Text` of markdown plus inline CriticMarkup. The web editor renders CriticMarkup delimiters as styled suggestions over plain text, with a per-user Edit/Suggest toggle (the link role sets the ceiling).
2. **Relay.** The existing Cloudflare Durable Object: live authority while editing, persists Yjs to SQLite, relays sync and awareness. Adds the cloud-bridge logic and the idle alarm.
3. **Backend abstraction.** One interface, two implementations:

   ```
   interface DocBackend {
     read(): { text, version }                       // version = Drive etag or GitHub sha
     write(text, expectedVersion, msg): { version }  // conditional on version; rejects on mismatch

     folderRef?(): string                            // the folder holding this doc
     list?(folderRef?): Array<{ name, isFolder, ref }>   // entries, folders first
     parentRef?(folderRef): string | null            // parent folder, null at the shared root

     canAccess?(userEmail): boolean                  // Drive only
   }
   ```

   Folder refs are opaque strings: a repo-relative path for GitHub, a folder id for Drive. The sidebar passes them back to `list()` and `parentRef()` without interpreting them.

   - `DriveBackend` (default) implements all of it through the Drive API.
   - `GitHubBackend` implements `read`, `write` and the folder methods (public directory listing over the contents API): `fetchPublicText` plus `fetchPublicDir` plus `commitFile`, behind the interface. It has no `canAccess`; GitHub docs keep secret-link auth. Building the sidebar against `GitHubBackend.list()` is the auth-free way to get folder navigation real before the Drive credential exists, and it doubles as the long-deferred GitHub folder feature.

4. **Cloud bridge** (in the relay):
   - On write: serialise the `Y.Text` and call `write(text, expectedVersion, msg)` conditionally. If the backend reports the file changed underneath (Drive 412, GitHub sha mismatch), re-read and diff-merge rather than overwrite. This is the guard the current commit-back lacks.
   - On external change: poll the backend (Drive `files.get` etag, or the changes feed) every few seconds. When the file has moved, read it and diff-merge into the `Y.Text` with diff-match-patch as positioned inserts and deletes, so an editor's save and the live edits combine instead of clobbering.
   - Normalise line endings and trailing whitespace before diffing, so a CRLF-versus-LF editor or an "add final newline" setting does not look like a real edit.

5. **Auth.**
   - Google sign-in returns the user's email (a non-sensitive scope: no Drive consent, no Google restricted-scope verification).
   - The relay calls `canAccess(email)` (Drive `permissions.list` on the file or its folder) and admits edit or suggest by what the ACL and the link role allow.
   - Secret links keep working unchanged for outsiders: one file, no sidebar.

6. **Folder sidebar.** A panel sliding in from the left, toggled by a header icon (mirror the existing right-side Preview toggle). Top to bottom: the current folder name with an up control to `parentRef(current)`; then `list(current)`, folders first then `.md` files, the open file highlighted. Folder rows re-list into that folder; file rows open that document's room. It only shows when the backend offers `list()`. On Drive, navigation is bounded by `canAccess`, so you cannot climb above the shared folder. It binds to the `DocBackend` folder methods, so it works against `GitHubBackend.list()` now and `DriveBackend` later with no UI change.

## Folder sidebar UI and the /open entry point

The sidebar (architecture point 6) and external callers both open a document by a backend ref rather than by minting a link per file.

- **Opening a file from the sidebar:** a route resolves `(backend kind, doc ref)` to a room, get-or-create, seeded from the backend file on first open, then navigates. Access is the signed-in path's single check, not a per-file key.
- **TagFox entry point.** TagFox shows folder rows for local markdown folders. Add a hover-revealed icon that calls `shell.openExternal(<mist-host>/open?path=<folder-relative-to-the-shared-root>)`, plus a configurable mist base URL in TagFox settings. The contract is **path-based**: TagFox passes a path relative to the shared vault root, and mist resolves path to Drive folder to room server-side, where the Drive credential already lives. TagFox needs no Drive access of its own. The icon and `openExternal` are buildable now; the resolving `/open` endpoint waits for `DriveBackend`.

## Access model

| Caller | How they get in | Scope |
|--------|-----------------|-------|
| Signed in, in the Drive ACL | Google sign-in, ACL check | Every file in the folders they can access; full sidebar |
| Secret edit link | `?k=editKey` | That one file, edit |
| Secret suggest link | `?k=suggestKey` | That one file, suggest only |

Two bonuses from the signed-in path: real names on cursors, and access that tracks the Drive ACL live, so unsharing in Drive makes the next join or resume fail.

## Conflict and merge rules

- The relay is the live authority while a session is open.
- Every write is conditional on the version token. A stale write is rejected and retried as a merge, never a clobber. This is what removes the "forgotten window overwrites a later edit" risk.
- External edits arrive by polling and merge by text diff at file-save granularity (a second or two), which is fine for staying in sync.
- Idle sessions close and flush, shrinking the window where two surfaces are both live.

## Idle auto-close

- Reset a last-activity stamp on each edit. An alarm (the same mechanism as the removed 99-hour expiry) fires after the idle threshold, flushes final state to the backend, and closes connections.
- The client drops to read-only and shows a banner with a Resume button (reuse the `OnboardingBanner` and `SaveStatus` patterns). Resume reopens the socket, which re-runs the key and Drive-permission check and re-syncs the latest state.
- Default threshold 20 to 30 minutes. Because we flush continuously, nothing is unsaved at close.

## Reuse versus build

Reuse, shipped and verified: the Durable Object relay and its SQLite persistence, secret edit and suggest links, the CriticMarkup parser, serializer and rendering, the Cloudflare deploy, and the GitHub read and write helpers, which become `GitHubBackend`.

Build: the plain-`Y.Text` document core and the editor changes for it; the `DocBackend` interface and `DriveBackend`; the cloud-bridge write-guard, polling and diff-merge; Google sign-in and the ACL check; the folder sidebar; idle auto-close and the resume banner.

## Build order

1. **Document core to plain `Y.Text` plus CriticMarkup**, with a per-user Edit/Suggest toggle. Prove live multi-client web editing and suggesting on the new core, and refactor the existing GitHub path onto `DocBackend` so nothing regresses.
2. **`DriveBackend` read and write**, plus the cloud-bridge write-guard and polling diff-merge. Prove a Drive file round-trips: open it from Drive, edit on the web, see it land in the Drive file and back out to a desktop editor; edit in the desktop editor, see it merge into the web doc.
3. **Google sign-in and the ACL check.** Prove a colleague in the share gets in, one who is not is refused, and the secret link still works as fallback.
4. **Folder sidebar:** the slide-out panel UI, the `/open?path=` route that opens a file by ref (get-or-create its room), and the TagFox hover icon. The `list`/`parentRef` data layer is done (`GitHubBackend`); on Drive it is bounded by the ACL.
5. **Idle auto-close and the resume banner.**

Each step is web-testable in the same fast loop that built the current app.

Progress, 12 June 2026 (auth-free work, done on mobile):

- Step 1 backend seam: `DocBackend` interface and `GitHubBackend`, with the GitHub read, write and import paths routed through it. Committed, unit-tested.
- Step 4 data layer: `GitHubBackend.list()`, `folderRef()` and `parentRef()` over the public contents API, unit-tested. The folder sidebar can now bind to a real backend without the Drive credential.
- Still needing a desktop or the Drive credential: the `Y.Text` core rewrite (browser testing), `DriveBackend` and the cloud bridge (Drive auth), and the visible sidebar panel plus `/open` route and TagFox icon (your eyes, plus `/open` waits for Drive).

Progress, 14 June 2026 (Drive credential now set as Worker secrets):

- `DriveBackend` (read/write/list/permissions) implemented; `/drive/import` opens a Drive markdown file into a room; the relay commit-back picks Drive or GitHub. Force-save and unsaved indicator generalised to any backend.
- Slides for Drive decks: deck `theme:`/`css:` resolve through a `/drive/asset` proxy that streams private-Drive assets via the relay (jsDelivr cannot reach private Drive). Inline `<style>` blocks hoisted to the iframe head. Reveal re-lays out on resize so the split pane is not blank.
- Drive quick-open search box (`/drive/search`): recent by default, name search, opens markdown in mist, drills into folders, opens other Drive files in a new tab.
- **Interim auth:** all `/drive/*` endpoints gated by a shared passphrase (`DRIVE_ACCESS_KEY` secret, `X-Drive-Key` header or `?token=`), fail-closed. This is a stopgap for the proper Google sign-in + per-file ACL, which remains the real auth (and would replace the passphrase, give named cursors, and bound folder navigation).

## Session of 15 June 2026. READ FIRST.

**TOP PRIORITY, unresolved (#33).** With explicit-save-only, edits live in the shared Yjs Durable Object and every collaborator sees them in real time, so everyone assumes the work is saved, but the Drive source file is NOT updated until someone presses save. If the DO is evicted or the file is opened in Obsidian, the work looks lost. The illusion of live persistence is dangerous. Make the unsaved state unmistakable (prominent persistent banner, warn on leave) and consider a SAFE periodic save once the round-trip is trustworthy (Y.Text core #13). Do this before leaning on mist for real collaborative editing.

**Sign-in (#7) is live.** Google sign-in is set up and working: secrets `GOOGLE_SIGNIN_CLIENT_ID` and `SESSION_SECRET` are set; a separate OAuth **Web** client (distinct from the relay's Desktop client) was created via `scripts/setup-signin.ps1`. Auth model: sign-in proves identity; the relay does Drive I/O as Steve; a user may open a file iff that file's Drive sharing grants their email (`canAccessFile` on the FILE). The passphrase still works as a fallback. Follow-ups before retiring the passphrase: the sandboxed slides iframe cannot send the session cookie so its `/drive/asset` requests still need a `?token=` (mint a short-lived signed asset token); `DriveBrowser`'s 401 path still prompts the passphrase. Note the file-vs-folder trap: in Drive a file can be shared without its parent folder, so per-file checks must target the file the user opened, never an incidental folder (this broke `/drive/bib`, see below).

**Zotero bib loading fixed.** `/drive/bib` had three bugs after #7: (1) it gated on the doc's FOLDER sharing, which 403'd when the file was shared but not the folder, so the whole bib failed to load and ALL citation features died (fixed: gate by sign-in only, not per-file folder). (2) the bib is not beside the doc (an Obsidian vault keeps it at `content/assets/MyLibrary.bib`), so it now walks UP ancestor folders checking each folder and its `assets/` subfolder. (3) a folder can hold several `.bib` files, so it merges all of them. Citations render in PREVIEW only (Steve does NOT want them rendered in the editor view).

**YAML-in-editor (#29) was tried and REVERTED.** Putting the frontmatter in the editor body so it shows/edits subjected multi-line YAML (nested `format/revealjs`, `css:` lists) to the editor's per-line paragraph round-trip, which mangled it (dropped keys, stray blank lines) and broke slides + the document preview. Reverted to the verbatim-separate model (frontmatter in the Yjs meta map, editor hides it). Re-approach only read-only or after the Y.Text core (#13). Do not put multi-line YAML through the current paragraph model.

**Shipped this session (deployed, tested):** the cross-doc concatenation structural fix (DocumentRoot owns useYjsEditor + guid + relay contamination tripwire, see below); blank full-screen slides preview fix (deck renders through the split's flex section); frontmatter-only deck detection (`format: revealjs`, not extension); navbar redesign into two icon radio pills (Mode: Editing/Suggesting; View: Editor/Split/Preview) with View in the URL (`?view=`); reveal.js menu + fullscreen + keyboard in the slides iframe; editor control-code styling (`:::`, `{.attr}`, raw HTML muted); editor shortcuts (Mod+B/I wrap, type a wrapper char over a selection to wrap, `=` for `==highlight==`); carry the View when opening a file from the sidebar; left-margin hover opens the sidebar; the outline panel (#31, navbar toggle, slide titles / doc heading-level filter, click to jump) with per-slide hide/unhide (`visibility="hidden"`, buildSlidesHtml omits hidden slides). Verification uses Playwright in `C:\tmp\mist-verify` (the doc loads via its `k` key, so decks/editor render without Drive auth; CSS/assets 401 there, which is expected).

**UX note saved (cross-project memory `feedback_ux_affordance_grouping.md`):** Steve cares that visual grouping mirrors logical grouping (separate radio groups as separate pills).

## CORRUPTION INCIDENT and current safety model (14 June 2026, evening). READ FIRST.

**What happened.** mist's auto-commit-on-open corrupted source files in two vaults. Two root causes: (1) the editor's Yjs doc did not reset when navigating between files, so one document's content was written into another file (the "Causal Map features" deck was written into the `bundle` glossary); (2) mist auto-committed back to the file shortly after it was opened, with no manual edit, on a throttle. It commits via the GitHub API, and these files also live in Drive, so it was double-syncing. Every write also injected the mist banner and reformatted YAML (stripped quotes, reordered keys).

**Concatenation fix (14 June 2026, evening).** Root cause (1) recurred because the first fix put `key={id}` on `DocumentProvider`, which sits BELOW where the `Y.Doc` is created (`useYjsEditor`, in the parent that React Router reuses across `/docs/X` to `/docs/Y`). So the doc was never reset and the next file merged into it, concatenating. Fixed structurally: the remount key now wraps a `DocumentRoot` that OWNS `useYjsEditor` (so each id gets a fresh doc), and the `Y.Doc` is created with `guid: docId` so its identity is bound to the document. Defence in depth at the relay (`agents/document.ts`): the doc is stamped with its id at seed (`stampDocId`), and `isContaminated` refuses to persist or broadcast any state whose stamp no longer matches the DO name, so a stale tab cannot write a cross-doc merge into storage. Shared helper `app/shared/doc-integrity.ts`, tested in `doc-integrity.test.ts`. Verified live with Playwright (two-file nav clean per Steve). The relay stamp is a tripwire (the stamp is itself a CRDT value, so last-writer-wins can keep ours); the client remount/guid is the actual guarantee.

**Recovery done.** 19c-slides: `git restore` of 4 tracked `.qmd`. 19aCMgarden: its `content/` is a SEPARATE nested git repo (`content/.git`), and mist had been committing "Update ... via mist" there since 10 June; recovered with `git checkout 4d9a2d4 -- .` (the clean "Garden content vault" baseline before the first mist commit, no legitimate edits after it) and committed. Garden rebuilt (`python build_static_site.py --clean`) and `dist/` pushed. Cleared `desktop.ini` files Drive injected into `.git/refs`. LEFTOVER manual cleanup for Steve (not deleted, his data): `800 Case studies/Copy of World Food Programme...md`, `cp-coffee-break-2026/slides (1).qmd`, about 41 stray `img/*` duplicates.

**Current safety model (deployed).**
- **Drive only.** All GitHub/git is disabled in mist: the relay never commits to GitHub (`backendFor` returns Drive only), `/gh/import` returns 410, the GitHub box is gone from home. Re-enable later only when the doc model is proven and double-sync is solved.
- **Explicit save only.** No auto-commit on open/typing. The relay writes back ONLY on an explicit save (`commitNow`); the client auto-commit effect and the throttled alarm are removed.
- **Faithful writes.** Frontmatter round-trips VERBATIM (raw text, only the `mist:` block removed) so quotes and key order survive; no banner is injected. A save of an unedited file is byte-for-byte identical (unit-tested in `thread-serialization.test.ts`). The parse/re-emit path runs only when the doc has comment threads.
- Still imperfect: body soft/hard-break fidelity for edited prose awaits the Y.Text core (#13). Until then, do not lean on saving heavily-edited garden `content/` files from mist.

## Shipped (Drive era, 12 to 14 June 2026)

Drive backend (read/write/list/permissions); open-by-link; folder sidebar for Drive (siblings, breadcrumb, hover-peek, cached reopen, opens below the header); unified search plus browse panel on the home page and sidebar (recent default from localStorage plus Drive recency, type filter, breadcrumb paths, sludge-dir exclusion, race-guarded, draggable recent divider); SPA navigation so the top bar persists on open; mode switches (Edit/Suggest/Preview/Split) in the navbar plus keyboard shortcuts (mod+alt E/S/V/backslash); collapsible right comment panel; slides preview fixes (deck CSS/images via `/drive/asset` proxy, inline `<style>` hoist, reveal `scrollActivationWidth:null` so the narrow split pane is not blank, 16:9 widescreen, mermaid best-effort); server-rendered `/slides/:id?print-pdf` route plus PDF button; document-preview mermaid plus Drive images; Drive BibTeX via `/drive/bib` so the `@`-picker works; Drive file ops via `/drive/op` (create, rename, duplicate, trash-recoverable) with a "+ New" button and per-row hover action icons.

## Shipped (14 June 2026, evening batch 2, verified live with Playwright)

- **Concatenation fix** (see the corruption section above): client remount/guid plus relay contamination tripwire. Steve confirmed two-file navigation is clean.
- **Blank full-screen slides preview fixed.** A deck previewed full (not split) was nested inside `<main>` where its iframe collapsed to zero height. It now renders through the same flex `<section>` the split uses, so it gets a definite height (verified: 22 reveal sections, 16:9).
- **Deck detection is frontmatter-only.** `isSlideDeck` keys on `format: revealjs` in the frontmatter, not the file extension, so a `.md` deck is detected and a `.qmd` document/report is not misread as slides.
- **Navbar redesign.** Two icon segmented groups: Mode (Editing vs Suggesting, shared doc state) and View (Editor only / Split / Preview only, per-viewer). Keyboard: mod+alt E/S for mode, 1/2/3 for view. The View is mirrored in the URL (`?view=split|preview`, editor is the default and carries no param) so a reload or shared link restores the layout.
- **Reveal menu and shortcuts restored.** The slides iframe gets `allow=fullscreen`+`allowFullScreen` (F works), reveal's controls/overview/keyboard stay on, and the reveal.js-menu hamburger loads best-effort (visible bottom-left).
- **Editor control-code styling.** Quarto/Pandoc syntax (`:::` fenced divs, `{.class ...}` attribute specs, raw inline HTML) is decorated muted, monospace and small (`md-control`/`md-control-faint`) so prose leads. New patterns in `markdown-decorations.ts`.
- **Sidebar label.** Top list relabelled "Recent in Drive" (Drive recency) vs "Recently opened" (this browser's mist history).

**Drive deck CSS finding (not a bug).** A deck opened from a stripped copy in a bare "folder1" lost its styling because none of its stylesheets (`../_shared/styles.css`, `../fontawesome/...`, same-folder `minimalist.css`) were present at that location. mist's `..` resolution and the `/drive/asset` proxy work; the assets simply were not there. Opening the deck from its real `19c-slides/005-minimalist-coding` folder (siblings intact) loads all four sheets.

## Sign-in (#7): built 15 June 2026, awaiting one Console step

Model (decided): Google sign-in proves identity; the relay still does Drive I/O as Steve; a user may open a file iff that file's Drive sharing grants their email (or domain, or anyone-with-link). Drive sharing is the single source of truth, no separate allowlist.

Built (server + UI), non-breaking, accepts a session OR the passphrase during transition: `session.server.ts` (HMAC cookie, tested), `drive-access.server.ts` (gate + `canAccessFile` + Google token verify via tokeninfo), structured `driveListPermissions` + `emailHasAccess` (user/domain/anyone), `/auth/google` and `/auth/logout`, all `/drive/*` routes gated, open/asset/op/bib enforce per-file sharing, `GoogleSignIn` button on home (inert until configured).

Secrets to set (names only; values never here): `GOOGLE_SIGNIN_CLIENT_ID` (a NEW OAuth 2.0 Web client, separate from the relay's Desktop client), `SESSION_SECRET` (random, for the cookie HMAC). Console: APIs & Services > Credentials under hello@causalmap.app, create OAuth client ID > Web application, authorised JS origin `https://mist.broad-smoke-cc64.workers.dev` (add `http://localhost:5173` to test on dev); ensure the consent screen lets colleagues sign in (add as test users or publish; openid/email are non-sensitive, no verification).

Follow-ups before the passphrase can be removed:
- The sandboxed slides iframe cannot send the session cookie, so its css/image asset requests still need the `?token=` passphrase; replace with a short-lived signed asset token.
- `DriveBrowser`'s 401 path still falls back to the passphrase prompt; switch it to prompt sign-in once the passphrase is gone.
- Search is gated by session but not per-file filtered (open-time is the enforced boundary); per-result filtering is a later refinement.

## Remaining (tracked in the task list)

Google sign-in plus per-file ACL to replace the passphrase (#7); external-change sync so Obsidian/desktop edits merge into open sessions (#9, cloud-bridge poll plus diff-merge); TagFox open-in-mist icon (#11, separate Electron repo); idle auto-close (#12, lower value now save is explicit); the plain `Y.Text` document core (#13, the foundational fidelity fix). These remaining items each need Steve: #7 a Cloud Console step and his Google login; #9 and #13 are data-path rewrites best done with him; #11 is a different repo. Drive write ops (#10/#18) shipped but still need Steve's passphrase to verify the actual writes end to end.

## Open decisions

- **Drive credential for the relay.** Decided 12 June 2026: use Steve's stored OAuth refresh token, so files stay owned by Steve and edits attribute to him. The service-account alternative (tidier server-side, but needs the folders shared with it and writes show as the service account) is not used. Secrets needed, names only, as Worker secrets alongside the existing `GITHUB_TOKEN`: the Google OAuth client id and secret, and the Drive refresh token.
- **External-change detection:** a few-second poll first, with Drive push notifications to a Worker webhook as a later refinement.
- **Idle threshold:** exact value.
- **Attribution:** all Drive writes show as the relay's identity, Steve or the service account, not the individual colleague. Acceptable, noted.

## Known issues

- **Frontmatter preservation: fixed (14 June 2026).** Import used to strip the YAML frontmatter, so a `.qmd` lost `format`/`theme`/`css`/`navigation` and a commit-back would have written the file without them. The fix carries the file's own frontmatter (the `mist` key removed, since threads are handled separately) through the document model: `deserializeThreads` returns it, the import routes pass it to the relay, the relay stores it in the Yjs `meta` map, `DocumentContext` reads it back, and `serializeThreads` re-emits it on commit-back and download. The slides preview now reads it locally from `DocumentContext.frontmatter` rather than refetching the source file from GitHub (the old stopgap is removed). Round-trip is covered by unit tests in `thread-serialization.test.ts`. Commit-back is now safe to keep the deck's configuration.
- **Body serialization fidelity (soft vs hard breaks): deferred to the document-core rewrite.** The current per-line paragraph model means typed prose can round-trip with single newlines where markdown wants a blank line for a paragraph break. This is not a frontmatter problem (frontmatter no longer passes through the editor) and not a workaround left in place; it is inherent to the XmlFragment core and is what build-order step 1 (move to plain `Y.Text` plus CriticMarkup) addresses. Track it there, not as a patch.

## Effort

The foundation (relay, links, CriticMarkup, deploy, GitHub helpers) is built and working. The real work is the plain-text core rewrite and the cloud bridge (write-guard, polling, diff-merge), with sign-in and the sidebar as bounded additions on top. Several focused days, low architectural risk because nothing underneath is speculative; the one fiddly routine is the text diff-merge.
