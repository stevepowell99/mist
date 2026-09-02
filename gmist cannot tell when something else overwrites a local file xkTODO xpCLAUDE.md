# gmist cannot tell when something else overwrites a local file

**Data loss, 2 September 2026. Steve lost a morning's comments and edits on a local
file. The work was recovered from the Durable Object state, then lost from disk a
second time the same hour.**

This file replaces an earlier write-up which said two gmist rooms had raced and
overwritten each other. That was wrong. The measurements below say gmist saved
correctly every time, and that something outside gmist rewrote the file underneath it.

## What happened

Steve annotated `C:\dev\causal-map-extension\rubicon\docs\principles.md` in gmist,
running in local-fs mode inside a TagFox child window rather than a browser tab. Ten
comment threads and several inline insertions, between 06:05 and 06:30. The Saved
indicator showed throughout and autosave to file was on. By the time he looked at the
file it held the version from before he started.

**His account is the constraint any explanation has to fit.** One gmist window on that
file. Ten minutes to half an hour of work. At most one close and reopen. So an
explanation that needs him to have opened the file four times is not an explanation.

## The saves landed. Here is the proof

The localfs sidecar returns a **content hash** as the version token
(`scripts/localfs-server.mjs`, `hashOf` is sha256 truncated to 16 hex characters), and
it computes that hash over the request body **after** `await fs.writeFile(abs, buf)`
has returned:

```js
"POST /write": async (params, req) => {
  const abs = absOf(params.get("path"));
  const buf = await readBody(req);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  console.log(`localfs: wrote ${abs} (${buf.length} bytes)`);
  return { version: hashOf(buf) };
}
```

The worker stores whatever that call returns, without computing anything of its own
(`agents/document.ts:558-568`, `recordSaved(version)`).

In Steve's room, `driveVersion` is `2950fa53cd668bfa`. The sha256 of that room's own
`pendingMd`, truncated the same way, is `2950fa53cd668bfa`. The DO could not have
minted that value. Only the sidecar could, and only by having received all 18,452
bytes and written them to disk without throwing.

**So Steve's work was on disk at 06:30:14.** Something removed it afterwards.

`absOf()` is `path.resolve(p)` with no root and no prefix, and there is no
`LOCALFS_ROOT` (`.dev.vars` carries only `SESSION_SECRET`, `LOCAL_FS_URL` and
`LOCAL_FS_TOKEN`). The id decodes to that exact absolute path. There was never a
second copy to find: an Everything content search for the comment text across every
`.md` on the machine returned nothing, and the only other `principles.md` anywhere is
an unrelated one in `qualia-deliberate`.

## What overwrote it

A concurrent Claude Code session working in the same folder.

That is proven for the last write and inferred for the earlier ones. At 06:55:41 the
file became 12,723 bytes, and it is byte-identical to
`causal-map-extension/_tmp/principles-new.md`, staged five seconds earlier at 06:55:36.
Both carry CRLF line endings. The content is a substantive editorial rewrite of the
document, terser throughout, which reads as a response to Steve's own comments. That
write destroyed the recovered copy, which had been put back at 06:43:39.

The same session had committed `principles.md` at 06:01, committed again at 06:04, and
wrote `rubicon/docs/rubicon-conversation-summary.md` at 06:35:11. `.git/index` was
refreshed at 06:36:31.

**Line endings separate the writers, but only for the 06:55:41 one.** gmist cannot
produce CRLF: the Y.Text body is normalised in `replaceBodyFromText`
(`agents/document.ts`), and every `pendingMd` and `lastCommitMd` measured in the four
databases carries zero CR bytes. The 06:55:41 write is CRLF, so it did not come from
gmist.

**The 06:36:26 write was LF, not CRLF, which corrects the table below.** Room
`df22f088` opened twelve seconds after it, at 06:36:38, and recorded
`driveVersion = e8071be3b7aac524`. That token is the sidecar's hash of the raw bytes it
read, and hashing the committed blob the same way gives `e8071be3b7aac524` for the LF
form and `f901c9aed423cdfd` for the CRLF form. So the disk held LF bytes at 06:36:38.
`core.autocrlf` is `true` in that repository, so a git checkout there writes CRLF, which
rules git out for the 06:36:26 write and for the earlier revert.

**No agent session made either of those two writes.** Every transcript under
`~/.claude/projects` was searched for tool calls between 06:29 and 06:37. Three were
found, all in the concurrent `causal-map-extension` session, and all three read-only: an
`ls -l` at 06:36:30, a `git diff` at 06:36:38 and a `find` at 06:36:54. That session's
last write to the file before the loss was at 06:00:59. So the inference that it
performed the revert does not hold, and the writer of the first two reverts is still
unidentified.

## The evidence

Four DocumentAgent databases under `.wrangler/state/v3/do/mist-DocumentAgent/`, all
carrying the same `drive.fileId`
`lf_QzpcZGV2XGNhdXNhbC1tYXAtZXh0ZW5zaW9uXHJ1Ymljb25cZG9jc1xwcmluY2lwbGVzLm1k`, which
base64url-decodes to exactly `C:\dev\causal-map-extension\rubicon\docs\principles.md`:

| agent (prefix) | created (BST) | lastCommitMd | pendingMd | driveVersion | sync_log |
|---|---|---|---|---|---|
| `fe9164a5` | 06:05:44 | 18,452 | 18,452 | `2950fa53cd668bfa` | 33 rows |
| `65c140e1` | 06:34:36 | 12,684 | none | `e8071be3b7aac524` | 1 row |
| `df22f088` | 06:36:37 | 12,684 | none | `e8071be3b7aac524` | 1 row |
| `a395d960` | 06:39:16 | 12,684 | none | `e8071be3b7aac524` | 1 row |

`fe9164a5` is Steve's room. Its `sync_log` shows `open edit` at 06:05:49 and then 32
`save` rows from 06:08:44 to 06:30:14, growing steadily: 12,990, 13,085, 13,088,
13,094, and on up to 14,773, 14,805, 14,893 characters. No `save-error`, no
`save-conflict`, no `upstream-error`. The logged figure is
`stripFrontmatter(pending).length`, which is why it ends at 14,893 while the stored
document is 18,452: the comment threads live in the frontmatter.

The other three rooms hold one `open edit` row each and nothing else. Their stored
content is 12,684 characters, LF only, **byte-identical to the blob at commit
`e7ffbb04`**, which is the version before Steve touched anything. Their shared
`driveVersion` of `e8071be3b7aac524` is the sha256 of that blob. So the disk had
already been reverted by 06:34:38, four minutes after his last save.

Timeline, with what was measured and what was reported:

| time | what | measured? |
|---|---|---|
| 06:05:49 | Steve's room opens | yes |
| 06:08:44 to 06:30:14 | 32 saves, all successful, last one 18,452 bytes to disk | yes |
| 06:30:14 to 06:34:38 | file reverted to the exact committed content, LF | yes, by the read at 06:34:38 |
| 06:34:38, 06:36:38, 06:39:19 | three more rooms open, each reading 12,684 LF | yes |
| 06:36:26 | file written again, LF (corrected above) | yes, by the read at 06:36:38 |
| 06:36:31 | `.git/index` refreshed | yes |
| 06:43:39 | recovered copy put back, 18,452 bytes | yes |
| 06:55:36 | `_tmp/principles-new.md` staged, 12,723 bytes CRLF | yes |
| 06:55:41 | `principles.md` overwritten with that file, byte-identical | yes |

The three later rooms did not write anything. No new room was created at 06:43:39 or
06:55:41, so those writes were not gmist either.

## Problem 1: local mode has no defence against an outside writer

Drive files get one. `doCommit` writes conditionally on the version it last saw
(`agents/document.ts:552-560`), and when the version has moved it re-reads, compares
bodies, and either re-anchors or raises a conflict. That whole apparatus does nothing
for a local file, because the localfs write ignores the baseline it is handed:

- `app/lib/google-localfs.server.ts:143-152`, `driveWrite(token, fileId, content)`
  takes no `expected` argument at all. The `expected` version that `doCommit` passes
  to `bound.backend.write` reaches `DriveBackend.write`
  (`app/lib/backend.server.ts:105`) and is dropped on the floor for local files.
- `scripts/localfs-server.mjs`, `POST /write` writes unconditionally.

So in local mode there is no version check, and a save can only fail by the sidecar
being unreachable. Nothing reads the file back afterwards either. A room can hold a
document that no longer resembles what is on disk and will keep reporting Saved.

That is what happened here twice over. The first three overwrites went unremarked
because nothing was watching, and the fourth destroyed a recovery.

**Fixed in `a0d2bc1`, and it is now the whole of local mode's conflict handling
(`ba4354c`).** `driveWrite` takes the baseline, and the sidecar compares it
against the file's current hash in the same step as the write, refusing with a 409 and
the same "changed upstream" message the Drive path uses, so the existing conflict
machinery fires. The check sits beside the write rather than in the worker, so there is
no window between the two for a stale writer to win. Verified against a running sidecar:
a write carrying a stale baseline is refused and the file is left untouched.

Worth settling alongside it:

- What the room should do when refused. Fork a sibling, as the Drive path does, or hold
  the pending content and tell the user.
- Whether an open room should notice an outside change without being asked, by
  re-reading periodically or by watching the file.

## Problem 2: every open mints a new room (separate, and real)

`app/lib/drive-import.server.ts:51`:

```js
const id = generateDocumentId();
```

There is no lookup for a room already bound to the same `fileId`. Its own docstring
says so: "Open a Google Drive markdown file into a **new** gmist room". TagFox's local
pen opens `http://localhost:5173/open?path=<absolute path>` in a child window
(`C:\dev\TagFox\CLAUDE.md`, "Open in gmist"), so every click mints another room over
the same file, each with its own copy of the content, each bound to the same path for
write-back, each free to autosave.

That is why three rooms exist here. They only read, so they are not what bit Steve, and
this was not the cause of the loss. But had anybody typed in one of them it would have
saved 12,684 characters over the top with no complaint, and the conditional write above
is what would refuse it.

**Gone for local mode in `ba4354c`.** Not fixed, removed: local mode no longer has
rooms at all. A local document is the file plus a buffer in the browser tab, so there is
nothing to mint on an open and no second copy to disagree with the first. `/open?path=`
redirects to the file and creates nothing.

Drive mode still mints a room per open, and there it is the right shape, because several
people really do edit one document. Tracked in
`xkTODO make open reuse the room per Drive file id.md`, along with what to do about
reviving a long-closed room and collecting one that holds unsaved `pendingMd`.

## Recovery recipe

The content survives in the Durable Object state, so this is worth knowing before it is
needed again.

1. The rooms live in `.wrangler/state/v3/do/mist-DocumentAgent/` as `<hash>.sqlite`
   plus `-wal` and `-shm` siblings. **Copy all three of a set out to a scratch folder
   and read the copies.** Never open the live files: wrangler holds them, and the
   recent writes are in the WAL rather than the main database.
2. Sort by modification time to find the candidates. A room being written holds a large
   `-wal`.
3. Read the `doc_state` table. The `drive` key is a JSON blob naming the `fileId`,
   which base64url-decodes to the absolute path, so it says which file each room holds.
   `pendingMd` is the live editor content and `lastCommitMd` is the last thing saved.
   Both are UTF-8 blobs.
4. The largest `lastCommitMd` across the rooms for one file is usually the one holding
   the lost work, since comments and threads only add bytes.
5. `sync_log` (`ts`, `event`, `detail`) is the room's own history: opens, saves,
   conflicts and errors.
6. `driveVersion` is the sidecar's content hash of the last write. Comparing it with
   sha256 of the room's own content, truncated to 16 hex characters, is how you tell
   whether a save reached disk. That is the check that settled this incident.

Write the recovered content somewhere outside the repo first. On 2 September the
recovery was put straight back into the working tree and a concurrent session
overwrote it twelve minutes later.

## What would have caught this

**The sidecar logs every write and nobody reads the log.** `POST /write` prints
`localfs: wrote <path> (<n> bytes)` on each write, and `scripts/dev-local.mjs` spawns
it with `stdio: "inherit"`, so the line goes to whichever terminal ran
`npm run dev:local` and is captured nowhere. Inside TagFox it goes to
`%LOCALAPPDATA%\TagFox\gmist-local.log`, which is read only when a start-up failure is
reported. Thirty-two lines showing 32 writes of a growing file would have settled the
first hour of this in seconds, and would have pointed straight at an outside writer
rather than at gmist. Capture it to a rolling file in dev mode.

**Nothing ever reads the file back after a save.** A save is reported as done on the
strength of the write returning, and no code path checks later that what is on disk is
still what was written. This is the "a check that can pass by finding nothing must
prove it looked" failure in its write-side form: the write really did happen, so the
check that would have caught the loss is the one nobody wrote. A re-read on a timer, or
on the next save, comparing the file's hash against `driveVersion`, would have shown
the file changing underneath the room within four minutes.

## Still unresolved

- **What performed the revert between 06:30:14 and 06:34:38.** The 06:55:41 write is
  proven, by a byte-identical staged file five seconds earlier. The earlier one is
  inferred from the same session being active in the same folder. It restored the
  exact committed content with LF endings, which is what a `Write` of previously-read
  content produces and not what `git checkout` produces here, since
  `core.autocrlf` is `true` in that repo and a checkout would have given CRLF.
  Reproducing it is not necessary to fix either problem above.
- **Why three rooms were minted at roughly two-minute intervals after Steve had
  stopped.** Each is a bare `/open`, so something re-navigated the TagFox child window
  three times. Worth a look at TagFox's window handling, though nothing in those rooms
  wrote anything.

## Until it is fixed

Do not edit a file in gmist local mode while an agent or another tool is working in the
same folder. gmist will report the save as done and will not notice the file being
replaced under it.


## Closed, 2 September 2026

Both problems are gone, by removing the thing that caused them rather than by guarding
it. `ba4354c` takes the room out of local mode: no Durable Object, no WebSocket, no
awareness, no adopt/fork/re-anchor, and no second copy of the content that could be
written back later. What remains is an ordinary editor's contract, which is what Steve
asked for three times before it was heard: read the file, edit a buffer, write it back,
refuse the write if the file moved.

Verified against a running sidecar: a file opens and edits save; a file changed on disk
behind the editor refuses the next write, shows Conflict, and the external content
survives.

**The writer of the two reverts on 2 September is still unidentified**, and that is
worth remembering rather than assuming the rebuild covered it. It could not have been
either problem above, since the three rooms never saved. What the rebuild guarantees is
that a local write now carries a baseline, so the same loss would be refused and
reported rather than landing silently.
