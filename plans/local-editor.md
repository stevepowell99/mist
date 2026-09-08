# A local editor, built from the file

Written 8 September 2026, after a day in which Steve lost work repeatedly to
gmist's local mode and finished the day back in VS Code.

## Why start again rather than keep fixing

Ten defects were fixed in local mode in one day: line endings rewritten on every
save, frontmatter reformatted on every save, no cache header so the browser
served a stale file which was then saved back, the dev server force-reloading the
editor a thousand times, autosave every two and a half seconds, a watch list lost
on restart, a reload that discarded the buffer with no recovery copy, no save on
close, a room minted per open, and three confident wrong attributions that sent
the investigation after `git checkout`, a session rewind and a stale editor
buffer in turn.

Those are not ten problems. They are one assumption showing through ten seams:
**gmist treats the document as living in the app, with the file as somewhere to
push it.** That is inherited from mist, where it was true, because the room was
the document and Drive was an export target. Removing the room on 2 September
left the assumption in place, so gmist went on behaving like the owner of a
document it was only visiting.

Retrofitting the opposite assumption is what took a day, because each fix meant
deleting a behaviour that looked deliberate. Starting from the file makes the
same behaviour trivial: there is nothing to delete, and no library whose habits
have to be resisted.

The measure of success is one sentence, and it is Steve's: **type in the editor
while an agent edits the same file, and see the agent's changes appear, without
either side losing anything.** VS Code with autosave does this today. Any phase
that does not survive that test is not finished.

## What VS Code actually does, since it is the specification

- **It saves about a second after typing stops.** This is the mechanism rather
  than a compromise. Because the buffer is clean nearly all the time, a change
  arriving from elsewhere can be taken silently, with nothing local to weigh it
  against. Saving slowly is what creates standoffs: gmist's autosave was
  lengthened to twenty seconds on 8 September and that alone prevents the live
  updating this plan exists to deliver.
- **It writes back the bytes it read**, changed only where the user typed. No
  normalising of line endings, no reformatting of anything.
- **It watches the file.** A clean buffer is replaced silently; a dirty one
  raises a prompt.
- **It refuses to resolve a genuine clash itself** and asks.

## Phase 1: the editor

The whole of it. A local document is a file on disk and a buffer in one browser
tab, and nothing else exists.

**Build**

- CodeMirror 6 over a plain `EditorState`. No Yjs, no awareness, no Durable
  Object, no room, no keys, no share links.
- Load: `GET /local/doc?id=` returns the text and a content hash. The text goes
  into the editor unchanged.
- Save: one second after typing stops, `POST /local/doc?id=&expected=<hash>`.
  Flush immediately on blur, on the tab being hidden, and on `pagehide` through
  `sendBeacon`, so closing the window can never lose the last edit.
- Watch: poll the hash every 700ms. Unchanged, do nothing. Changed and the buffer
  is clean, replace the differing span only, so the cursor and scroll position
  survive. Changed and the buffer is dirty, raise the prompt and let the user
  choose.
- Conflict: a 409 from the conditional write is shown, never resolved silently.
  The buffer is written to a recovery file beside the document before anything
  replaces it.

**Delete**

`useLocalEditor`'s Y.Doc and awareness, the local branch of `DocTransport`, the
room-reuse path in the agent, and the local half of `resolveDoc`. Local mode
should not import from `agents/` at all when this is done.

**Test, and it is the only test that counts**

Open a file. Type continuously. Have an agent rewrite a different paragraph of
the same file twice. Both sets of changes are present, no prompt appeared, and
`logs/file-history.log` shows the alternating writes. Then repeat with the agent
rewriting the paragraph being typed in, and check the prompt appears and the
recovery file exists.

## Phase 2: the things that only read

Preview, citations, slides, the outline and scroll sync are pure functions over
the document string and already exist: `applyGrammar`, `renderCriticHtml`,
`parseBib`, `slides-build`, `insertPosAnchors`. None touches storage, so they
attach to the new editor with no change to how the file is handled.

The one point of care is that the preview reads the same string the editor holds
rather than a second copy of it, which is what `Preview` already does through a
memoised `dangerouslySetInnerHTML`.

## Phase 3: comments and CriticMarkup

The only part that touches storage, the only thing gmist has that VS Code does
not, and therefore the only reason to build any of this. It should not start
until phase 1 has survived several ordinary working days.

CriticMarkup is literal text in the body and needs no storage decision at all.
Comments are the problem: they live in a `mist:` key in the file's frontmatter,
so writing them means writing the header, and rewriting the header is what
produced one of today's defects.

Two options, to be decided then rather than now:

- **Splice, never re-emit.** Keep the author's frontmatter as the text they wrote
  and insert or replace only the `mist:` block, which is what
  `serializeThreads` was changed to do on 8 September. Cheap, and already
  written, but every comment still rewrites the file's header.
- **Keep comments beside the file**, in `<name>.md.comments`, anchored by quoted
  text rather than by offset. The document then never changes when a comment is
  added, which means an agent rewriting the prose cannot collide with a review in
  progress at all. Costs a second file and an anchoring problem when the quoted
  text is edited away.

The second is the better fit for the aim, since it removes the last reason for
the editor to write the file when the user has not typed.

## Phase 4: Drive mode

Unchanged. Rooms, the Durable Object, the CRDT and the share links stay where
they are, because there they are doing the job they were designed for: several
people editing one document at once. Nothing in phases 1 to 3 should touch it.
The seam is `resolveDoc` and the storage facade, both of which already exist.

## What not to do

- Do not carry Yjs into local mode "in case it is useful later". It is the reason
  the buffer and the file were ever two different things.
- Do not normalise anything on the way to disk. Line endings, frontmatter,
  trailing whitespace, final newlines: write back what was read.
- Do not lengthen the save interval to reduce collisions. It does the opposite,
  by keeping the buffer dirty and blocking the silent adoption that makes live
  editing work.
- Do not add a fifth diagnostic layer. `logs/file-history.log` and
  `logs/snapshots/` are enough, and are editor-agnostic; keep them whatever else
  changes.
