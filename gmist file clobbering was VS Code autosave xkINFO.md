# Opening a file writes a stale copy over it

Found on 8 September 2026 while working in `causal-map-extension`. Opening
`rubicon/docs/principles.md` in gmist appeared to write an eight-hour-old version
of the file over the current one on disk.

## It was VS Code, not gmist

Steve had `principles.md` open in VS Code the whole time and never looked at it.
His user settings carry `"files.autoSave": "afterDelay"`, so VS Code writes its
own buffer back on a timer and when its window loses focus. Opening gmist takes
focus away from VS Code, which is why the two looked causally linked: gmist was
the thing being switched to, not the thing writing.

Three lines of evidence, all from logs taken at the time.

- **gmist wrote nothing.** `logs/file-history.log` is written by the sidecar next
  to each write, and the sidecar is the only way gmist can touch the disk. Its
  last write to `principles.md` was 14:55:32. The four reverts (17:18:57,
  17:24:25, 17:30:34, 17:45:13) are all recorded as
  `changed-by-something-else`, and there is not one `refused` either, so gmist
  did not so much as attempt a save in that window.
- **The writes are the wrong shape for gmist.** Each revert is an in-place write
  with no temp file, and `vca-worked-comparison.md` or `triangulation.md` changes
  within a second of it. gmist writes one file, the one open in a tab, and
  `Code` is in the busy-process list at 17:45:14 and 17:46:31. Saving several
  dirty editors at once is what VS Code does when its window loses focus.
- **The content is a buffer, not an edit.** Every revert is byte-identical to
  `5078ca17:rubicon/docs/principles.md` (104,212 bytes), eight commits back, which
  is what the file held at 16:11 when VS Code last read it.

The atomic-rename writer the first version of this note pointed at was named by
Steve's own watcher once it had run long enough: `pid 26220 = claude.exe`, and
that process wrote both the 16:11 content and, at 17:26, the good content. It was
an author, not the clobberer.

## What was fixed in gmist anyway

The lock landing in `PlainEditor` only (`d457fad`, `2a212da`) left the two local
editors not excluding each other: `/open` redirects to `/edit`, but
`/docs/<local id>` is still reachable from history or a restored tab and mounts a
second buffer over the same file. Both routes wrote `principles.md` today. The
lock is now one hook, `app/lib/useFileLock.ts`, called by both.

## What is left

- **Steve's side.** `"files.autoSave": "afterDelay"` in a repo agents also write
  is a clobber machine, and it is per-machine, so it belongs in the hub rather
  than here. Either turn autosave off, so VS Code shows its "file changed on
  disk" bar instead of writing over the change, or do not leave a file open in
  VS Code while an agent is editing it.
- **Still open in gmist:** each open of a DRIVE file mints a new room, tracked in
  `xkTODO make open reuse the room per Drive file id.md`. Local mode has no rooms
  and is not affected.
