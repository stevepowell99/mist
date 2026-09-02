# Opening a file twice makes two rooms, and they overwrite each other

**Data loss. Found 2 September 2026 after Steve lost a morning's comments and edits.**

## What happened

Steve annotated `C:\dev\causal-map-extension\rubicon\docs\principles.md` in gmist between
05:08 and 05:29: ten comment threads and several inline insertions. The Saved indicator
was showing and autosave to file was on. At 06:36 the file on disk was rewritten with the version from before any of that,
byte-identical to the last git commit apart from line endings. His work was gone.

It was recoverable. `.wrangler/state/v3/do/mist-DocumentAgent/` held **four separate
DocumentAgent databases for that one file**, all carrying the same
`drive.fileId` of `lf_QzpcZGV2XGNhdXNhbC1tYXAtZXh0ZW5zaW9uXHJ1Ymljb25cZG9jc1xwcmluY2lwbGVzLm1k`:

| agent | lastCommitMd | pendingMd | last write |
|---|---|---|---|
| `fe9164a5…` | 18,452 | 18,452 | 06:30 |
| `df22f088…` | 12,684 | none | 06:36 |
| `65c140e1…` | 12,684 | none | 06:34 |
| `a395d960…` | 12,684 | none | 06:39 |

`fe9164a5…` is the one holding his work. The other three each hold the file as it was
before he touched it, and one of them saved over him.

## Why

`app/lib/drive-import.server.ts:51`:

```js
const id = generateDocumentId();
const stub = await getAgentByName(env.DocumentAgent, id);
```

Every open mints a fresh document id. Nothing looks for a room already bound to that
`fileId`. Nothing warns either. The function's own docstring says it plainly: "Open a Google Drive markdown file
into a **new** gmist room". So opening the same file four times, whether from TagFox's
deep link or the in-app sidebar, produces four independent rooms, each holding its own
copy of the content, each bound to the same path for write-back, each autosaving.

The DocumentAgent id is the mist document id, and the file identity lives underneath it as
metadata, so two rooms over one file are invisible to each other. Last writer wins. What it writes
is its own buffer. That is why the Saved indicator told the truth. The room that saved really had saved.
What it saved was the file as that room had loaded it.

Local files make this much worse than Drive. Two rooms over a Drive file at least contend
through `driveVersion`, the headRevisionId taken at open, which gives a conditional write
something to refuse on. The localfs sidecar just writes the path.

## Fix

Dedupe on open. Before minting an id, look for a live room already bound to that `fileId`
and return it. That needs a `fileId -> documentId` index, which does not exist today, so
this is not a one-line change.

Things to settle while doing it:

- A room whose document was closed long ago should probably not be revived without
  asking. A time bound, or an explicit "reopen the existing room" choice.
- What the second opener sees. Joining the live room is the collaborative answer. It is also a change
  in behaviour, since today they get a private copy.
- Conditional write for local files. The sidecar could carry an mtime or a content hash as
  the baseline, so a stale room is refused rather than obeyed. Worth having even after
  dedupe, because it turns this class of bug from an unannounced loss into a visible error.
- Whether a room with unsaved `pendingMd` should ever be garbage collected.

## Until then

One gmist tab per file. Close the old one before reopening from TagFox.

## Recovery recipe, since this will happen again before it is fixed

The content is in the Durable Object state and survives. Copy the `.sqlite`, `-wal` and
`-shm` triplets out of `.wrangler/state/v3/do/mist-DocumentAgent/` (copy, never open the live ones). Then read `doc_state` for `pendingMd` and `lastCommitMd`.
The `drive` key says which file each room holds. The largest `lastCommitMd` is usually the
one with the lost work, since comments and threads only add bytes.
