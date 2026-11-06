# CLAUDE.md

Guidance for Claude Code in this repository. Global guidance is the hub `C:\Users\Zoom\.claude\CLAUDE.md`; this project is registered in its Project Index.

## gmist

gmist is Causal Map's internal editor for collaborative markdown documents and slides: like Google Docs, but for `.md` files, with files and permissions coming from Google Drive. The aim is that a file edited locally one day and in gmist the next is the same file, equally and seamlessly. Synchronous multi-user editing is not a goal. README.md has the feature list, tech stack and layout.

- **Origin.** It began as a fork of [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (Matt Webb's editor) but has diverged completely and does not track upstream: there is no `upstream` remote and nothing to merge, so treat "based on mist" as irrelevant to current work. Remote: `origin` = `stevepowell99/mist`.
- **Naming.** The product is "gmist" (`APP_NAME` in `app/shared/constants.ts`). The structural identifiers stay `mist` on purpose: the worker name, which fixes the live URL and every shared link, and the `mist:` frontmatter key, which holds saved comment threads. Do not rename either; why, and what a rename would need: `docs/technical-architecture.md`, "Naming".
- **Three supported modes; keep all three working.** Drive-bound rooms (the main mode), unbound rooms (shared documents without a Drive file, made from the home page), and local-fs mode (this machine's own files, no Drive).
- The old `19c-slides` slides app is being retired; gmist has its own slides implementation (`app/lib/slides-build.ts`) and depends on nothing in that folder.

## Start of session

Read `docs/design-system.md` (visual design) and `docs/technical-architecture.md` (platform, stack and, under "Design notes", the decisions behind each area with the incidents that taught them). Before changing an area, read its section there: the rules below are the one-line residue of each. Check `plans/` for an active plan; `plans/live-collab.md` and `plans/handover.md` record June 2026 and are history.

## Workflow

- **Always deploy to remote after changes** (`npm run deploy`) so Steve can test on the live worker, then give him the URL. The same command puts the local gmist on the new build. The dev server has cold-start flakiness on first open of a fresh room; the deployed worker does not, so remote is the source of truth for verification.
- **A backgrounded `npm run deploy` can exit 0 without shipping** (hit 14 July 2026). If a fix does not show up live, grep the fetched deployed JS for the new code before assuming the fix is wrong.
- **Commit directly to `main`**, one concern per commit, once the change typechecks; it is a solo project that deploys from `main`, without a PR or branch workflow. `npm run deploy` does NOT commit. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **One agent at a time on this working tree.** Two sessions here interleave edits in the same files, either one's commit bundles both, and either one's `npm run deploy` ships the other's in-progress code. Run one at a time, or give each session its own `git worktree`.
- **Localhost is for occasional testing only, never for real work.** Real editing happens on the deployed worker. `npm run dev` runs the Worker and Durable Objects in workerd here, so it spends none of the account's DO duration. On a cold Vite cache the first open of a fresh room can fail to sync ("Outdated Optimize Dep"); hard-reload or open it again. Local Google sign-in needs `http://localhost:5173` in the sign-in client's Authorized JavaScript origins. Collaboration needs the deployed site.
- **A Claude session never starts gmist from its own shell.** A background shell dies with the session, or is reaped for memory, and takes gmist with it. The GmistLocal task runs the local gmist; nothing on the click path may cause a build (one takes one to three and a half minutes here).
- **Do not edit the two gmist example files from disk without checking with Steve** (`gmist-examples-deck.md` and `gmist-examples-doc.md` in the `19c-slides` Drive folder). He keeps them open in gmist as a live writer while testing, so a disk edit races autosave and spawns conflict siblings. Propose the change and let him apply it, or confirm they are closed; where a sibling exists, keep his text and add only the agreed tweak.
- **A fork sibling is something to merge, not damage.** When a `… (drive copy …)` or `… (gmist unsaved …)` sibling appears, run the global `merge-conflicts` skill the same day rather than choosing a side by hand; keep the CRDT route (`gmist-review`) for anything live. Why: technical-architecture, "Drive sync and conflict safety".
- **Before hunting a gmist bug, check what else has the file open.** gmist writes to disk only through `POST /write` in `scripts/localfs-server.mjs`, which logs every write, and every change it did not make, to `logs/file-history.log`, with content in `logs/snapshots/`; one grep answers whether gmist wrote. Two editors on one file is the hazard, whichever the second editor is. Read `docs/who-writes-this-file.md` before investigating; the house rule is the hub's "When a file keeps reverting or looks clobbered".
- Playwright here is the Python package, not the npm one.

## Hosting, deploy and secrets

- **Cloudflare Workers, free tier**, account `hello@causalmap.app`, auth by `npx wrangler login` (no `CLOUDFLARE_ACCOUNT_ID` needed). Worker `mist` at [mist.broad-smoke-cc64.workers.dev](https://mist.broad-smoke-cc64.workers.dev). Config `wrangler.jsonc`: the `DocumentAgent` Durable Object (SQLite), the `BROWSER` binding (Browser Rendering, for PDFs) and the optional `LIBRARY_FOLDER_ID` var. `npm run deploy` is `scripts/deploy.mjs`: build, upload, then refresh the local gmist. CI: `.github/workflows/ci.yml` (Node 22).
- **Free-tier limit.** An open WebSocket keeps a Durable Object billing duration, so tabs left open can hit the daily DO cap (resets 00:00 UTC); idle auto-close in `useYjsEditor` is the mitigation, the $5/month Workers Paid plan the escape. Detail: technical-architecture, "Cloudflare cost".
- **Worker secrets** (`wrangler secret put`; write-only, so `.dev.vars` reuses the originals):
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: the Drive relay identity, one Google account; minted and loaded by `python scripts/mint-drive-secrets.py` (local dev: `node scripts/get-refresh-token.mjs` writes the token into `.dev.vars`).
  - `GOOGLE_SIGNIN_CLIENT_ID`, `SESSION_SECRET`: browser sign-in and the session cookie HMAC; set by `pwsh -File scripts/setup-signin.ps1`, which generates the session secret.
  - `DRIVE_ACCESS_KEY` is unused and can be deleted (`wrangler secret delete DRIVE_ACCESS_KEY`).
  - Build-time, optional: `VITE_FATHOM_SITE_ID`, `VITE_FATHOM_DOMAINS`. Local only, never in production: `LOCAL_FS_URL`, `LOCAL_FS_TOKEN` (generated by `dev:local`). Template: `.dev.vars.example`.
- **OAuth consent screen mode (Google Cloud project 402686357169, hello@causalmap.app):** while the consent screen is in **Testing**, refresh tokens expire after 7 days, so the relay breaks weekly. Fix once: set User type to **Internal** (if causalmap.app is a Workspace domain: no verification, tokens never expire, but only causalmap.app accounts) or **Publish app** to Production (tokens stop expiring; an "unverified app" warning until verified). Mint `GOOGLE_REFRESH_TOKEN` AFTER changing this, or the token is still on the 7-day clock. The relay OAuth client is `…ck5m0fhfg…`; the browser sign-in client is `…1d50288j…`; both share the project's one consent screen.
- **Local gmist (local-only).** The GmistLocal logon task (`scripts/install-local-gmist-task.ps1`, asserted by the hub's `machine-parity.ps1`) runs `node scripts/local-gmist.mjs serve`, logging to `%LOCALAPPDATA%\TagFox\gmist-local.log`. TagFox's "Open in gmist" opens `http://localhost:5173/open?path=<absolute path>`. Detail: technical-architecture, "Local-fs mode".
- The headless client `scripts/gmist-bot.mjs` authenticates to Drive documents with a `mist_session` cookie from `$GMIST_SESSION` or the gitignored `scripts/.gmist-session`; rooms do not need one.

## Rules by area

Each line is a rule; the section of `docs/technical-architecture.md` named in its heading has the reasoning and, where there was one, the incident.

### Sync and saving (technical-architecture, "Drive sync and conflict safety")

- **Content is the source of truth; a Drive `headRevisionId` is only a hint and a timestamp is decoration.** Decide "did it change?" by comparing bodies (`stripFrontmatter`), never by revision id or `modifiedTime`. Do not reintroduce version- or time-based "newer" logic.
- **Do not propose making gmist Drive-API-only** to dodge the multi-writer churn: the file being a real local and Obsidian file is the point of choosing Drive.
- **The relay never silently overwrites the editor.** `checkUpstream` in `agents/document.ts` adopts Drive on a reopen with nothing unsaved, forks only an independent third version to a sibling, and snapshots before an explicit reload; a body equal to our own last save under a new revision id is churn and re-anchors.
- **The unsaved badge baselines against the editor's own serialization, never the relay's stored file bytes**, and is gated on `userEdited`; the agent sends no connect-time `committed`.
- **The save/dirty machinery refactor is PARKED.** Do not start it without a reason, and then integration tests first.
- **The `Y.Text` body is LF-only, and a CRLF file must not convert to LF on save.** Canonicalise CRLF to LF wherever content enters (`driveRead`, the agent seed, `replaceBodyFromText`); `scripts/localfs-server.mjs` writes back in the endings the file already had. Never put verbatim CRLF into the `Y.Text`.
- **The save-path frontmatter regex in `app/lib/thread-serialization.ts` stays strict** (`FRONTMATTER_RE`). A tolerant one, tried in June 2026, made the seed differ from Drive and progressively corrupted YAML documents; strip frontmatter display-only in Preview instead.
- **Keep one live writer per file where you can.** A file Drive for Desktop syncs has two writers, the relay and Desktop pushing a stale local copy.
- First stop when sync looks wrong: the agent's `sync_log` (`?synclog`), shown in the Drive sidebar's "Sync activity" via `/drive/docinfo`.

### Access and security (technical-architecture, "Auth and access")

- **One `authorizeDoc()` in `drive-access.server.ts` decides access**; the hard gate is the agent WebSocket upgrade in `workers/app.ts`. The effective role is the more restrictive of the link role and the Drive role.
- **An asset token is never a session.** Only `/drive/asset` (`assetAccess`) and `/print` for the one file it names read one. Never let `driveAccess` or `openDriveRequest` accept a token: it would reach every `/drive/*` route across the relay Drive.
- **Unbound rooms:** the secret links are the whole access control; by design there is no HTTP write endpoint, so every edit goes through the CRDT (`gmist-bot.mjs` for Claude).
- **The localfs sidecar's token is its whole access control.** Every request carries `LOCAL_FS_TOKEN` and any request bearing a browser `Origin` is refused; the loopback bind protects nothing, and by design there is no path allowlist. The sidecar owns all path arithmetic; the worker holds only opaque ids and never splits a path.
- **Local mode is switched by an env var, decided once in `getDriveAccessToken`, and travels in the token.** Do not reintroduce a hostname sniff or a module-level mode flag.

### Where shared logic lives (technical-architecture, "Where shared logic lives" and "Local-fs mode")

Reuse these; never re-inline or redefine them.

- `applyGrammar` (`app/lib/slides-build.ts`): the one grammar pipeline for the slide builder, the document Preview and library thumbnails. `deckRuntimeScript` (`slides-runtime.ts`): the deck's in-iframe runtime.
- Every `/drive/*` route opens with `openDriveRequest()` and uses `json()` (`app/lib/http.server.ts`) and the mime tables (`app/lib/mime.ts`).
- `app/lib/critic.ts`: the one CriticMarkup grammar for Preview and the deck build; `cm-criticmarkup.ts` holds only the CodeMirror decorations.
- `importDriveFileToRoom` (`app/lib/drive-import.server.ts`): shared by `/open?file=` and `POST /drive/import`.
- `resolveDoc` (`app/lib/doc-resolve.server.ts`): every route that opens a document by id goes through it. Do not put a `getAgentByName` call in a route.
- `app/lib/google.server.ts` is the storage facade over `google-drive.server.ts` and `google-localfs.server.ts`; a new storage operation goes in both, and the `StorageOps` type guards it.
- `useFileSync` (`app/lib/useFileSync.ts`) holds every rule about a local file and its buffer; add a sync rule there, never in an editor. Each editor's `FileSyncBuffer.normalise` is the method to get right: read its paragraph in "Local-fs mode" first.
- `printPdf` (`app/lib/pdf.server.ts`) prints both decks and documents. `shareLink`, `deckPdfLink` and `docPdfLink` (`ShareButton.tsx`) build the share and PDF links everywhere they appear.
- `searchScore` (`app/lib/fuzzy.ts`) ranks both pickers; `useChordListener` and `useSplitDrag` hold the `docs.$id` keyboard and gutter logic.
- **`app/styles/classes.json` is the single class catalogue.** The stepped numeric axes in `deck-base.css` are GENERATED from it: edit `classes.json`, then `npm run gen:styles`; never hand-edit between the GENERATED markers.
- Client code never imports from `agents/` (it uses `cloudflare:` imports the browser lacks); shared types go in `app/shared/`. `~` resolves to `app/`; use `~/lib/foo`, not relative paths.

### Local editor (technical-architecture, "Local-fs mode")

- **There is one local editor, `PlainEditor` at `/edit/<id>`**; `/open?path=` and `/docs/<local id>` both redirect to it. `docs.$id` is rooms only: do not add a second editor over a local file or a `local` branch in that route.
- `SlidesView`, `PresenterRail` and `CommitButton` take props rather than reading `useDocument()`, because the local editor has no document context; keep them that way.
- The file lock (`app/lib/useFileLock.ts`) has three states, `waiting`, `held` and `blocked`; do not collapse them into a boolean.
- A local id is `lf_` + base64url of the path, not eight characters: a route matching on a document id accepts both (`isLocalFileId`).
- If library `drive:<id>` images stop loading locally after a Drive for Desktop update, look first at the DriveFS database lookup in the sidecar's `/drive-id`.

### Editor and preview (technical-architecture, "Editor and preview")

- **The editor is CodeMirror 6 over a single `Y.Text` of raw markdown**; CriticMarkup is literal text styled by decorations. Do not reintroduce marks or a node model.
- **`Preview` never passes a fresh object to `dangerouslySetInnerHTML`**: memoise it, or every render wipes mermaid and anything else injected after render.
- **A view-wide class on the editor goes through `EditorView.editorAttributes`** (`attrsCompRef` in `CodeMirrorEditor.tsx`), never `view.dom.classList`, which CodeMirror rewrites on focus.
- **Live preview decorations rebuild when the syntax tree changes**, as well as on document, selection and viewport changes, and any decoration callback must be total: a ViewPlugin that throws is silently removed.
- **Scroll sync has one coordinate, the source character offset**, with one `<br data-pos>` anchor per top-level block (`insertPosAnchors`). Do not reintroduce a pixel-based CodeMirror measurement for content below the viewport. A marker never interrupts a paragraph or splits a list. The comments pane follows and never drives.
- Documents bundle mermaid and detect it by fence content, not by the `language-mermaid` class; decks still load it from a CDN (`xkTODO deck mermaid still CDN and class-only.md`).

### Slides and themes (technical-architecture, "Slides, themes and presenting" and "Printing to PDF")

- **A theme is only variables** (`--slide-bg`, `--ink`, `--accent`, `--accent-2`, optional `--divider-bg`, a font family) plus its accent and component overrides; the canvas is set once in `PREVIEW_CSS`. `causal-map.css`'s header is the reference for writing one.
- **Dividers and title slides are coloured by reveal's full-viewport background**; do not reintroduce a `background` on a divider or title section.
- Friendly class names are aliases in `CLASS_ALIAS` (`slides-build.ts`), composed from standard utility classes; add new sugar there, not as new CSS. A component's overridable defaults go in `:where(...)`.
- **Every theme names a Google web font first and `@import`s it** at the top of its CSS: the PDF browser is Linux with none of the Windows fonts.
- Native Ctrl/Cmd+P on a deck crashes the browser, so both editors intercept it; keep the interception when touching print.
- The slide and image library folder is the `DEFAULT_LIBRARY_FOLDER_ID` constant in `app/lib/library.server.ts` (a folder id, not a secret); the `LIBRARY_FOLDER_ID` var overrides it per deployment.

### Known limitation

- Each open of a Drive file mints a new room, and the share link is per room (`xkTODO make open reuse the room per Drive file id.md`).

## Authoring decks and documents

The canonical author syntax is `docs/author-grammar.md` plus `app/styles/classes.json`. The hub skill `gmist-author` is the procedure and house style; the project skill `.claude/skills/gmist-review` reads and edits a live document through `scripts/gmist-bot.mjs` (`.claude/skills/` is version-controlled). Do not copy either skill's content here.

## Commands and tests

README.md lists the main commands. Also:

```bash
npm run dev:local     # local-fs mode: the localfs sidecar and the dev server together
npm run preview:local # local-fs mode from a build in build-local/
npm run local:refresh # put the running local gmist on a fresh build, without uploading
npm run gen:styles    # regenerate the GENERATED region of deck-base.css (--check for CI)
npm run cf-typegen    # Cloudflare Worker types
npx vitest run tests/unit/lib/critic.test.ts   # one test file
npx vitest run -t "pattern"                    # tests matching a pattern
```

- Node.js 22 (the version CI uses).
- The `agents` package uses `cloudflare:` imports and **cannot** be imported in plain Vitest: test agent logic through integration tests or mock the imports, and keep unit tests on `app/lib/` and `app/shared/`. Tests live in `tests/unit/` and `tests/integration/`, mirroring the source.
- Coverage thresholds are a floor a point or two under the suite (`COVERAGE_FLOOR` in `vitest.config.ts`), so a run goes red only when coverage drops. Raise the floor by hand when a batch of tests lands.
- ESLint: prefix unused variables with `_`; tagged template expressions are allowed (for `this.sql` in Durable Objects).
