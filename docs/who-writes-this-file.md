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

That is the mechanism to look for first: **an agent editing a file through Bash
rather than through the Edit tool**. The harness checks whether a file has moved
since it was read, but only for its own Read/Write pair. A heredoc, `cat >`, or
`sed -i` bypasses that check completely and rewrites the whole file from whatever
the session holds in memory.

Grep the transcripts under `~/.claude/projects` for the filename, over a window
either side of the change, and look for `Bash` rather than `Edit`. Do not filter
by "did an agent write it" using the Write and Edit tools alone; that search
returns nothing and reads as an exoneration.

**The other losses on 2 and 3 September remain unattributed.** One confirmed
writer does not explain them, and Steve reports that some happened while he was
editing and no agent was running. Do not present the heredoc mechanism as the
established cause of all of them.

## What actually protects the work

A commit. Nothing that has destroyed work here, a `git checkout --`, a session
rewind, or a whole-file write from a stale copy, can reach an object already in
git. gmist has a Commit button for exactly that, and it is worth more than
everything above.
