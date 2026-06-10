# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Steve's fork

This is Steve Powell's fork of [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (Matt Webb's collaborative markdown editor). Everything below this section is upstream guidance and still applies; keep it intact so upstream merges stay easy.

- Remotes: `origin` = `stevepowell99/mist`, `upstream` = `inanimate-tech/mist`. Pull upstream changes with `git fetch upstream && git merge upstream/main`.
- Purpose of the fork: share a markdown file (or later a folder) from Steve's Google Drive or GitHub with collaborators via a secret link, for async review with CriticMarkup suggestions and comments. Collaborators need no account; only Steve's GitHub is involved. Separate from the Qualia apps.
- Global guidance: read `C:\Users\Zoom\.claude\CLAUDE.md`. This project is registered in its Project Index.
- Editor: Claude Code.

### Roadmap

1. DONE 10 June 2026: deployed to Cloudflare Workers free tier at [mist.broad-smoke-cc64.workers.dev](https://mist.broad-smoke-cc64.workers.dev) (account `hello@causalmap.app`, auth via `npx wrangler login`, no `CLOUDFLARE_ACCOUNT_ID` needed). Verified: POST `/new` creates a document and the editor renders it with a live WebSocket connection. Redeploy with `npm run deploy`.
2. DONE 10 June 2026: removed the 99-hour expiry (alarm in `agents/document.ts`, TTL constants, header copy, demo and README copy, tests). Also centred the editor and preview columns and moved the Preview toggle to the top of the right sidebar.
3. DONE 10 June 2026: secret capability links. Each document has an `editKey` and a `suggestKey` (stored in the Durable Object). The URL carries `?k=<key>`; the loader and the WebSocket upgrade both validate it, so a bare or wrong-key URL 404s. An edit-link holder can switch to Suggest mode; a suggest-link holder is locked to suggest and never sees the mode toggle or accept/reject actions. The Share menu offers both links to edit-role users. `POST /new` returns the edit link. Suggest enforcement is client-side (Yjs updates are opaque to the server); the server gates who can connect. Also done same day: markdown tables (aligned monospace in the editor source, real bordered table in Preview), default line length 30% wider (91ch), default body font 20% larger (1.38rem).
4. DONE 10 June 2026 (single file): import a markdown file from a PUBLIC GitHub repo by pasting its URL on the home page, and commit the reviewed result back. Decided to use public repos only: reads need no auth and images are served straight from `raw.githubusercontent.com` (no proxy). Preview rewrites relative image URLs (markdown `![]()` and HTML `<img src>`) to raw URLs. Commit-back is the only path needing a fine-grained PAT (`GITHUB_TOKEN`, Contents: write), gated by `ADMIN_KEY` so only the admin can write, not edit-link holders; the admin key is stored in the browser and sent with the commit request. Both secrets are set with `wrangler secret put`. Still TODO under this item: folder import with file navigation between docs.
5. Bibliography: support a `My Library.bib` the way the Garden project does, starting simple by showing a reference list at the bottom of the rendered document.
6. Before sharing links widely, review `npm audit` (31 inherited vulnerabilities, 2 critical, as of 10 June 2026) and consider offering changes upstream as PRs where general.

### GitHub integration setup

Commit-back needs two Worker secrets (reads and images need neither):

```
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT, Contents: write, scoped to the repos you commit to
npx wrangler secret put ADMIN_KEY      # any strong string; entered once in the browser to authorise a commit
```

Import: paste a `github.com/<owner>/<repo>/blob/<branch>/<path>.md` URL on the home page (public repos only). Commit back: Share menu, "Commit to GitHub" (edit link only, on GitHub-backed docs).

### Local dev gotchas

- `npm run dev` serves at `http://localhost:5173`. On a cold Vite cache, the first click on New document or drag-and-drop 504s ("Outdated Optimize Dep") because the editor route lazy-loads TipTap/Yjs and Vite re-optimises mid-navigation. Hard-reload the browser or restart the dev server; deployed builds are unaffected.
- Scratch work goes in `_tmp/` (gitignored locally); Playwright here is the Python package, not the npm one.

## Start of Session

Read project documents to load context:

- `docs/design-system.md` — visual design, typography, colours, layout
- `docs/technical-architecture.md` — platform, framework stack, directory structure, critical rules

Also check `plans/` for any active plan.

## Project Overview

MIST is a collaborative markdown editor — a cross between GitHub Gist and Google Docs. Users can quickly share and do multiplayer editing on markdown documents in real-time. Everything is public by URL (no auth yet). Documents persist live with no save button. (Upstream auto-expires documents after 99 hours; this fork removed that.)

## Tech Stack

- **Backend:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Frontend:** React Router 7 (SSR) + Cloudflare Agents SDK
- **Editor:** TipTap 3 + Yjs (CRDT multiplayer)
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
3. **TipTap** uses `@tiptap/extension-collaboration` (bound to the Yjs doc's `XmlFragment`) and `@tiptap/extension-collaboration-caret` for cursor awareness.
4. **Worker entry** (`workers/app.ts`) — `routeAgentRequest()` intercepts `/agents/:agent/:name` requests before React Router handles the rest.

### CriticMarkup / Suggest Mode

Track-changes functionality spans multiple files:

- `app/lib/critic-marks.ts` — ProseMirror mark definitions (criticAddition, criticDeletion, criticComment, criticHighlight) with `inclusive: false`
- `app/lib/suggest-mode.ts` — ProseMirror plugin that intercepts edits and applies addition/deletion marks instead of direct changes
- `app/lib/critic-parser.ts` — Parses CriticMarkup syntax (`{++ ++}`, `{-- --}`, etc.) into clean text + mark ranges
- `app/lib/critic-serializer.ts` — Serializes marks back to CriticMarkup delimiter syntax
- `app/lib/critic-markup.ts` — TipTap extension that wires up the CriticMarkup marks and delimiter decorations

### Testing Constraints

- The `agents` package uses `cloudflare:` imports — it **cannot** be imported in plain Vitest. Test agent logic through integration tests or mock the imports. Unit tests should focus on pure logic in `app/lib/` and `app/shared/`.
- Coverage thresholds ramp linearly from 0% to 80% between Feb–Dec 2026 (see `vitest.config.ts`).
- Tests live in `tests/unit/` and `tests/integration/`, mirroring the source structure.

### ESLint Conventions

- Unused variables must be prefixed with `_` (e.g., `_args`, `_ctx`).
- Tagged template expressions are allowed (for `this.sql` in Durable Objects).
