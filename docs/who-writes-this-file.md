# What happened to this file

Between 2 and 7 September 2026 the same document was reverted five times. This
page says where to look, so the next investigation starts where the last one
stopped.

## The two things that are recorded

- **`logs/file-history.log`** — one line per observed change to any file gmist
  has open, whoever made it. A gmist write records the bytes written, the bytes
  that were there before, the version it expected, the version actually on disk,
  and the browser that asked. A change gmist did not make is recorded as
  `changed-by-something-else`, with the hashes either side. Local time with an
  offset throughout: never compare it against a log in UTC.
- **`logs/snapshots/<file>/`** — every version of every file gmist has open, kept
  fifty deep, named by time and content hash. This is what makes a loss a copy
  rather than an investigation, and it has recovered work three times.

Together they answer what changed, when, and whether gmist did it. They do not
answer which process did it.

## Naming the process

Two attempts failed and are worth not repeating. Sampling running processes
around the change catches only a writer that started moments before, and the one
writer ever positively identified had been alive for hours. Windows object-access
auditing was switched on and produced no events.

What did work was reading the session transcripts. Session `e8f8dbe9` was writing
`rubicon/docs/principles.md` through `python - <<'PY'` heredocs at 22:20:03,
22:20:43, 22:21:07 and 22:21:20, matching the recorded changes to the second.

That is one mechanism, but it is no longer the one to look for first: **an agent
editing a file through Bash rather than through the Edit tool**. The harness
checks whether a file has moved
since it was read, but only for its own Read/Write pair. A heredoc, `cat >`, or
`sed -i` bypasses that check completely and rewrites the whole file from whatever
the session holds in memory.

Grep the transcripts under `~/.claude/projects` for the filename, over a window
either side of the change, and look for `Bash` rather than `Edit`. Do not filter
by "did an agent write it" using the Write and Edit tools alone; that search
returns nothing and reads as an exoneration.

## Look here first: what has the file open

An open editor window is a writer, and it costs one command to check where the
transcript grep costs minutes. On 8 September 2026 the file reverted four times
in half an hour and the writer was VS Code, autosaving a stale buffer of a file
Steve had left open behind everything else and never looked at. His user settings
carry `"files.autoSave": "afterDelay"`, so the window writes its buffer back on a
timer and when it loses focus, with no check on what is on disk.

Three things told it apart from an agent, and all three are in the logs already:

- **gmist recorded no write and no refusal** for three hours either side, which
  rules gmist out on its own, since `POST /write` is its only route to the disk.
- **The write was in place with no temp file, and sibling files in the same folder
  changed within a second of it.** An agent writes one file through a temp file and
  a rename, named `<file>.tmp.<pid>.<hex>`, so the pid names the process. Several
  files written at once is an editor saving its dirty buffers.
- **Each reverted copy was byte-identical to an old committed state**, and the four
  reverts alternated between two of them, seven commits and one commit back. An
  edit produces content nobody has ever committed; a buffer reproduces exactly what
  it read, and two buffers reproduce two things.

It reads as a mystery because nobody counts an untouched window as a process, and
because it fires when the window loses focus, so it looks like whatever was
switched TO did it. gmist was blamed for three days on that correlation.

**The losses on 2 and 3 September remain unattributed.** Steve reports that some
happened while he was editing and no agent was running, which the editor mechanism
would explain, but nobody has gone back to check. Do not present any one mechanism
as the established cause of all of them.

## What actually protects the work

A commit. Nothing that has destroyed work here, a `git checkout --`, a session
rewind, a whole-file write from a stale copy, or an editor autosaving a stale
buffer, can reach an object already in git. gmist has a Commit button for exactly that, and it is worth more than
everything above.
