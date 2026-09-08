# Opening a file writes a stale copy over it

Found on 8 September 2026 while working in `causal-map-extension`. Opening `rubicon/docs/principles.md` in gmist wrote an eight-hour-old version of the file over the current one on disk. Nobody pressed save, and the tab had not been open in that session.

## What happened

The file was restored from git and verified: blob `9e906eb4`, matching `HEAD`. It then held through forty consecutive checks over about a minute with gmist shut, so nothing else on the machine was writing it.

gmist was then opened, with the express intention of reading the file. Within seconds the file on disk was blob `94cbef40`, which is an earlier commit of the same file from 16:11 that day. Every line that differed was older text, and the write silently discarded four commits, two of them from another agent working in the same repo.

The same file had been reverted to that same blob three times earlier in the day, each time within minutes of gmist being in use.

## Why this is serious rather than annoying

The file is a live working document that several agents and a person edit in turn. A write that reverts it eight hours costs whatever was not committed, and misattributes the loss: the first three occurrences were blamed on a Claude Code session, on a session rewind and on a stale editor buffer in turn, and two long-running Claude sessions were killed on that evidence before the cause was isolated.

It is also invisible. gmist reports nothing, git reports the file as merely modified, and the person reading the file in gmist sees the old text and concludes their collaborator's work never landed.

## Evidence to work from

- The write goes through an atomic rename. The temp file observed was `principles.md.tmp.<pid>.<hex>`, so the writer can be identified by the pid in that name.
- gmist leaves fork files named `principles (unsaved 2026-09-08 1042).md` and `principles (unsaved 2026-09-08 1302).md` beside the target, which is its own record of holding buffers from those times.
- A watcher built for this incident is at `causal-map-extension/rubicon/tools/watch-principles.ps1`. It watches the directory rather than the file, logs one JSON line per event to `_tmp/principles-watch/writes.jsonl`, and says whether the bytes now on disk match a committed version or an ancestor of it. Reuse it here rather than writing another.

## What the fix has to establish

- **Opening a file reads it from disk.** Never write on open, under any circumstance, including restoring a session, reattaching a tab or recovering an unsaved buffer.
- **A buffer older than the file on disk is a conflict**, so it is shown as one and the person chooses. It is never resolved by writing.
- **A fork file is not a licence to write the fork's content back to the original.** If the two have diverged, keep the fork and leave the original alone.

Worth checking whether the same path runs on reconnect and on window focus, since the three earlier occurrences were minutes apart while the app was merely open.
