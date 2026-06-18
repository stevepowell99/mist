# gmist

gmist is Causal Map's editor for collaborative markdown documents and slide decks backed by Google Drive: like Google Docs, but for `.md` and `.qmd` files. A file edited locally one day and in gmist the next is the same file. You share a file by a secret link; collaborators sign in only to pass the file's Drive sharing, then read, comment, suggest changes (CriticMarkup) or edit.

## A radical fork

gmist began as a fork of [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (Matt Webb's collaborative markdown editor) but has diverged completely and no longer tracks upstream. The editor core was rewritten (CodeMirror 6 over a single `Y.Text`, replacing the TipTap/ProseMirror stack), all GitHub code was removed in favour of Google Drive as the only backend, and a full slides system was added. Treat "based on mist" as history: the architecture, the data model and the feature set are gmist's own. The structural identifier `mist` survives only where renaming would break things (the Cloudflare worker name, which fixes the live URL, and the `mist:` frontmatter key that stores comment threads).

## Features

### Documents and slides from one file

- Any `.md`/`.qmd` in Drive is a document; add `format: revealjs` (or `slides`) to the frontmatter and the same file is a slide deck.
- Editor, split (editor + live preview), and preview-only views, per viewer.
- A document or deck reads the same whether opened in gmist, Obsidian or a plain editor.

### Editing

- CodeMirror 6 over a single `Y.Text` of raw markdown: the saved file is exactly what you type.
- Live multiplayer presence (cursors and who-is-on-which-slide); synchronous multi-user editing is not a goal, async review is.
- A `/` slash menu inserts structures (columns, boxes, cards, callouts, big numbers, shapes, images, speaker notes); a `.` menu autocompletes the styling classes from the deck's own CSS.
- Citations: type `@` to pick a reference from a `bibliography:` `.bib`, inserted as `[@key]` and rendered to inline APA with a reference list.

### Review

- Suggest mode records edits as CriticMarkup additions and deletions; an edit-link holder accepts or rejects them one at a time or all at once.
- Threaded comments and highlights (`{>>note<<}` / `{==text==}`), anchored to the text by content, kept in the file's frontmatter.

### Slides

- An independent reveal.js deck builder with gmist's own composable "house framework": orthogonal class axes for components (`.panel`, `.cards`, `.callout`, `.chip`, `.bignums`, shapes), colour, fill (`.bg-<colour>`), border, the theme's own palette (`.accent`, `.page`, ...), shade, scale, opacity and absolute placement.
- Themes set in the frontmatter (`theme:`): causal-map, qualia, brutalist, editorial, blackboard, moonshot, handwritten, minimal. The same theme styles the document preview, so a doc reads like its deck.
- A shared library gallery drops reusable slides and images into a deck (by-id `drive:` references that resolve at render).
- One Present mode (Ctrl/Cmd+Alt+P, the Present button, or F in the deck): the app goes fullscreen, the chrome hides, and a presenter card shows the time, position, next slide and the current slide's notes.

### Drive and sharing

- Open and browse files from Google Drive in a sidebar; edits autosave back to the file, conflict-safe (it never silently overwrites newer content, and snapshots before a risky reload).
- Share a file by a secret link with an edit role or a suggest role; the link is not enough on its own, the reader must be signed in with a Google account the file is shared with.
- Self-hosted on Cloudflare Workers; Drive is reached through one relay Google identity, so collaborators need no gmist account.

## Tech stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) (backend, per-document state, SQLite persistence)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (the real-time WebSocket document agent)
- [React Router 7](https://reactrouter.com/) (SSR)
- [CodeMirror 6](https://codemirror.net/) bound to [Yjs](https://yjs.dev/) `Y.Text` via `y-codemirror.next` (the editor and the CRDT)
- [reveal.js](https://revealjs.com/) in a sandboxed iframe (the deck renderer)
- [Tailwind CSS 4](https://tailwindcss.com/) (app styling)
- TypeScript (strict), Vitest

## Getting started

Requires Node.js 22+ (see `.nvmrc`) and a Cloudflare account. gmist needs Google OAuth credentials and a session secret to reach Drive; see `.dev.vars.example` for the variables and `CLAUDE.md` for the relay-identity and OAuth setup.

```bash
npm install
npm run dev          # local dev server at http://localhost:5173
npm run deploy       # build and deploy to Cloudflare Workers
```

### Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers
npm run typecheck    # cf-typegen + react-router typegen + tsc
npm run lint         # ESLint
npm run test         # Vitest with coverage
```

## Project structure

```
agents/       Durable Object document agent (server-side state, relays Yjs)
app/
  components/ UI components
  lib/        Editor logic, CriticMarkup, the slides builder + runtime, Drive helpers
  routes/     File-based routing (home, docs.$id, the /drive/* endpoints)
  shared/     Types and constants shared between client and server
  styles/     deck-base.css (the house framework), classes.json, themes/
workers/      Cloudflare Worker entry point
docs/         Design system, architecture, the author grammar
plans/        Design notes (live-collab.md is the current truth)
```

Architecture and the author grammar are documented in `docs/`; project guidance and the current state are in `CLAUDE.md`.

## Licence

[MIT](LICENSE)
