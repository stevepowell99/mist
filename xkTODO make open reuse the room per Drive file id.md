Every `/open` call mints a new room, so two people opening the same Drive file
get two rooms both bound to it, and both save back. The design note and the
reason it was accepted are in `CLAUDE.md` under the open-by-id deep-link; this
file is only the tracker.

It started to matter on 28 August 2026, when `/open` gained `&share=` and became the
way a file is handed to a collaborator. The share link is per room, so:

- Reopening a file via `/open` strands anyone still holding the previous link in
  the old room. Both rooms then write to the same file and the conflict
  machinery does the reconciling.
- The workaround is to keep the link you handed out and not reopen the file
  through `/open` afterwards.

Fix: make `importDriveFileToRoom` deterministic per `fileId`, reusing the
existing room where one is live. The repo's own note calls this a larger change
than it looks, so read that first.
