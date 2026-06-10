# Plan: live Obsidian sync (plain-text Yjs + CriticMarkup)

Status: design for discussion, 10 June 2026. This proposes pivoting away from the git import/commit-back model towards live CRDT sync between a desktop Obsidian file and online collaborators, in the style of the Peerdraft plugin. No code until this is agreed.

## Goal

Steve edits a note in Obsidian on the desktop. Collaborators open a secret web link and read, edit, and suggest. Changes flow live both ways with no git step. Steve can close Obsidian, a colleague edits, and on reopen their edits are already merged into the local file. Suggestions and comments survive, carried as CriticMarkup.

## Why pivot

The git model we built (import, edit in mist, commit back) is a point-in-time snapshot with no live link. A push from Obsidian is never picked up by an open mist doc, and commit-back overwrites HEAD with no conflict guard. That is fine for occasional review but not for "the file and the web are the same living thing". Live CRDT sync removes the round-trip entirely.

## How live CRDT sync works

Every keystroke is a small Yjs update, not a file version. All participants join a "room" and a relay server passes updates between them. Each side keeps a state vector of what it has seen; on reconnect the two swap notes and ship only the missing updates, and Yjs merges them deterministically with no manual conflict step. Offline edits on both sides merge on reconnect.

The "close it, reopen later, their edits are there" behaviour needs the doc to persist while a client is away. An always-on relay that persists the doc gives this (Google-Docs style). Pure peer-to-peer does not, because the doc only lives in connected clients.

## The document model: one plain-text Yjs doc

The whole document is a single Yjs `Y.Text` holding markdown, with suggestions and comments encoded inline as CriticMarkup:

- addition: `{++ new text ++}`
- deletion: `{-- removed text --}`
- comment: `{>> a comment <<}` (optionally anchored to a preceding `{== highlighted span ==}`)

This is the key simplification. Because CriticMarkup is plain text, one `Y.Text` carries prose, tracked changes, and comments together. Plain-text CRDT binding to a plain-text editor is exactly what makes the Obsidian bridge tractable, unlike mist's current ProseMirror-structure-with-marks CRDT.

## Modes: per-user edit or suggest (Google Docs style)

Each collaborator chooses their own mode, Edit or Suggest, exactly like Google Docs. The choice is per-user and local, not a document-wide setting. This is a deliberate correction to the current mist, which stores mode as a single shared value; per-user is the right model.

- Edit mode: the user's keystrokes change the shared `Y.Text` directly.
- Suggest mode: the user's keystrokes are wrapped inline as CriticMarkup before going into the shared `Y.Text`, so an insertion becomes `{++...++}` and a deletion becomes `{--...--}`. Everyone sees the suggestion live, because it is just text in the shared doc.

The secret links still set the ceiling: an edit-link holder may switch between Edit and Suggest; a suggest-link holder is locked to Suggest (the work already done on link roles carries over). The document owner accepts or rejects a suggestion by resolving the CriticMarkup (keep the added text, drop the deleted text, remove the markers).

Obsidian side: typing in Obsidian changes the file directly, so the desktop user is effectively in Edit mode. To suggest from Obsidian, type CriticMarkup directly, which Steve already does. A later plugin toggle could wrap typed text as CriticMarkup for a true Suggest mode in Obsidian, but it is not needed to start.

## What we reuse from mist versus rebuild

Reuse:
- Cloudflare Durable Object as the persistent Yjs relay (already always-on, already persists Yjs state to SQLite). This is the right backend and needs little change beyond binding a `Y.Text` instead of a ProseMirror `XmlFragment`.
- Secret capability links (edit and suggest keys, loader and WebSocket validation). Carries over unchanged.
- The CriticMarkup parser, serializer, and delimiter rendering, for the web editor's styled view.
- The Cloudflare Workers deploy and the existing hosting.

Rebuild:
- The document core moves from a ProseMirror `XmlFragment` with marks to a plain `Y.Text` of markdown plus CriticMarkup. The web editor renders CriticMarkup delimiters as styled suggestions over plain text, rather than holding rich marks.
- A new headless sync agent (the file-to-`Y.Text` bridge), which is the main new build. No custom Obsidian plugin: Obsidian's own external-change reload plus Steve's existing Track Changes (CriticMarkup) plugin cover the desktop side.

## Off-the-shelf options assessed (June 2026)

Neither existing tool fits, mainly because neither does suggesting.

- **Peerdraft** ([peerdraft/obsidian-plugin](https://github.com/peerdraft/obsidian-plugin)): GPL v3. Has a web editor via secret link, so non-Obsidian collaborators can join. Live editing with cursors; merges on reconnect. But persistent shares (the "close it, reopen later, edits are there" behaviour) need a paid account (from 30 USD/year), there is no self-host, and it has no suggesting, track-changes or comments. GPL also means adapting its code forces our code to GPL.
- **Relay** ([No-Instructions/Relay](https://github.com/No-Instructions/Relay)): plugin and server both MIT, Yjs-based, and the server self-hosts on fly.io. But it is Obsidian-only with no web editor for non-Obsidian collaborators, and no suggesting. Tiered pricing for the hosted service.

Conclusion: use neither wholesale. Build the web half ourselves on mist's MIT backend (avoiding Peerdraft's GPL), and for the local file use a small sync agent rather than a custom Obsidian plugin.

## Local file sync: a headless agent, not an Obsidian plugin

Steve will use the web editor, and only needs the local `.md` to stay in step so Obsidian and the garden build see changes. Obsidian already reloads files changed on disk, and his existing Track Changes (CriticMarkup) plugin renders suggestions. So we do not need an Obsidian plugin at all. Instead a small headless **sync agent** runs on the desktop:

- A Node process that connects to the relay room for a document over WebSocket, carrying the secret key, and binds the on-disk `.md` to the shared `Y.Text`.
- File changed on disk (Steve edits in Obsidian, which saves) -> compute a minimal text diff against the current `Y.Text` and apply it as positioned Yjs inserts/deletes, so concurrent web edits merge rather than get clobbered (diff-match-patch is the standard tool here).
- `Y.Text` changed (a web collaborator edited) -> write the new text to the file; Obsidian detects the external change and reloads, and the Track Changes plugin styles any CriticMarkup.
- Guard against the write-echo race: when writing `Y.Text` to the file, ignore the file-change event it triggers (flag or content compare).

This is much smaller and lower risk than an Obsidian plugin: no Obsidian API, no CodeMirror binding, and it is a plain Node script we can test headlessly the way we tested the web app this session. Granularity is file-save level (a second or two), not keystroke, which is fine for "stays in sync".

Mapping a note to a room: a sidecar map (path -> document id and key) the agent reads, or the id and key in the note's frontmatter.

## Reconcile-on-reopen rules

The hard case is the file on disk changing while the agent is not running (another app, or a git pull). Proposed rule, matching how session-based tools behave:

- While the agent is running, the CRDT is the source of truth; the agent keeps the file in lockstep.
- On startup for a known room, the agent compares the on-disk file with the CRDT state from the server. If the file is unchanged since the last synced state, fast path: just apply server updates. If the file changed while the agent was off, diff the local file against the CRDT and apply the difference, so nothing is silently lost.
- If the relay has no memory of the doc (server reset), the local file seeds a fresh room.

## Suggestions and comments in plain text: trade-offs

- Suggestions ride along as CriticMarkup, so they survive in the file and in Obsidian.
- Comments anchored to an exact selection are looser than mist's mark-based anchoring. Inline `{>> <<}` next to a `{== ==}` highlight is the pragmatic version; position drift is handled by the CRDT keeping the delimiters next to their text.
- Obsidian shows raw markup unless a CriticMarkup plugin is installed. Steve already works in CriticMarkup.

## Open questions

- One relay per file, or a folder/collection of rooms with navigation? The folder idea from the earlier plan still applies.
- Authentication for the Obsidian plugin: reuse the secret key per document, or a single owner token in the plugin settings.
- How much of the existing mist web editor to keep versus a leaner plain-text editor with CriticMarkup styling.

## Rough build order

1. Switch the Durable Object and a minimal web editor to a plain-text `Y.Text` of markdown, with CriticMarkup styling and the per-user Edit/Suggest toggle. Prove live multi-client web editing and suggesting.
2. Build the headless sync agent: connect to a room, bind one `.md` to the `Y.Text`, two-way live sync with diff-based merge. Prove desktop file to web live sync.
3. Startup reconcile and the off-while-changed merge.
4. Comment affordances on the web side if wanted beyond inline CriticMarkup.
5. Folder/collection of rooms with navigation if wanted, and a tidier way to map files to rooms.

## Effort versus the work just done

The web half is comparable to a solid chunk of this session: a focused rewrite of the document core (plain `Y.Text` plus CriticMarkup) on top of the backend, secret links and CriticMarkup tooling we already have, with the same fast web test loop. The sync agent is the new piece, but as a headless Node script it is far smaller and lower risk than a custom Obsidian plugin would have been; the one genuinely fiddly part is the diff-based file-to-CRDT merge. Overall this is bigger than a single feature from this session but well short of the Obsidian-plugin route, and it stays in the fork-and-adapt, fast-feedback style that made this session quick.

## Relationship to current mist

If we pivot, the git import/commit-back feature becomes redundant for the Obsidian use case and can be retired, though the public content repo we set up is still useful as a backup and as the published-site source. The Cloudflare backend, secret links, and CriticMarkup tooling carry forward, so this is less a throwaway than a change of the document core plus a new client.
