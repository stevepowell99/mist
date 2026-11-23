Question: On 20 November 2026 a gmist room wrote a stale copy of the Pilots agenda deck over three newer edits made on disk, and nothing was kept; the cause is that when a room and Drive have both changed, gmist keeps the room's text and puts Drive's text in a "(drive copy)" sibling, which a room that has been open for hours can get wrong. Should gmist reverse that rule, so Drive stays and the room's text goes to a "(gmist unsaved)" sibling, before the code fix (refuse any write whose base is not Drive's current text) is built?
Options: Drive wins, the room's text goes to a "(gmist unsaved)" sibling | Keep the room winning, and only fix the paths that lose the sibling | Ask per case in the editor when both sides changed
Grade: leaning: Drive wins protects work made outside the room, but it reverses the "keep the live editor" rule in CLAUDE.md, so a person typing in a live room may see their text pushed to a sibling
Tier: Steve
Kind: sync-conflict-winner
Raised by: Delivery manager, 2026-11-23
Answer: ask per case in the editor when both sides changed (Steve, briefing page, 2026-11-23). This replaces the rule "keep the live editor" in `CLAUDE.md` under Sync and saving, which the fix must update.

# A room must never write a state older than the Drive revision it last saw

Reported by the Pilots session, 20 November 2026 (times UTC).

## What happened

- File: `Pilots or passengers - first call agenda.md`, Drive id `1s7WEaaS-TojCT8rKc5Bh4miKOZkOTeOT`.
- Drive revisions, all by "Causal Map":
  - 15:21:26: the agenda then held the deck (the same bytes as the slides file at 15:16).
  - 17:43:19 and 17:43:30, then 18:56:31, 18:57:02 and 18:57:12: edits made on disk, the last three by the Pilots session.
  - 18:58:33: a gmist room wrote the 15:21 deck back over them.
- The 18:58:33 body equals the 15:21 one except for the `strands` thread, re-stamped `created` 18:57:35 in the `mist:` block, with its inline CriticMarkup reduced to plain "strands" (as reported).
- Nothing was preserved: neither a `(drive copy …)` nor a `(gmist unsaved …)` sibling exists in the folder or in the Drive trash.
- The timing matches a test of Comment on this slide on that deck at about 18:57.
- The room's sync log has not been read, because the room id is unknown here. Read it before fixing: `/drive/docinfo?id=<room>&k=<key>`, signed in, is read-only and does not connect. It names which of the write paths listed under "How a room can write over a newer Drive version" ran.

## How a room can write over a newer Drive version

Code as of `ac1fe43`.

- The save is gated on a revision id (`driveVersion`), and these paths move that id to Drive's head while the editor keeps its own body:
  - `conflict-fork` in `checkUpstream` (`agents/document.ts`): sets the baseline to Drive's text and revision, keeps the editor and broadcasts `forked`. The client's `forked` handler (`DocumentContext.tsx`) saves at once, so the room's body replaces Drive by design, with Drive's version kept only in the sibling.
  - The same path when the sibling write fails: `savedAs` is null and the `catch` is empty, yet it still re-anchors and broadcasts `forked`. The comment at `agents/document.ts:574` says "we must not overwrite"; the code overwrites. Since the folder does not hold any sibling, this is the likeliest path here.
  - `churn-reanchored`: re-anchors when Drive's body equals our last save; safe only while that comparison is right.
- `driveWrite` (`google-drive.server.ts`) skips its precondition when `expectedVersion` is null or Drive returns no `headRevisionId` (`current.version && …`): a check that passes by finding nothing.
- The precondition is read-then-write, so an upload by Drive for Desktop between the two still loses.

## Fix

- When both sides changed, the editor asks the person which version to keep, case by case (Steve's answer above); until they choose, nothing is written to Drive. Today Drive's version goes to `(drive copy …)` and the room wins.
- Invariant: a room writes only if Drive's body at write time equals the body the room last adopted or saved (`lastCommitMd`). Compare bodies, as `CLAUDE.md` says, since a revision id is only a hint; on any mismatch, refuse.
- The baseline moves only to content the editor actually holds: never `setBaseline` to a Drive version the editor did not adopt.
- A failed sibling write blocks the save instead of letting it proceed.
- `driveWrite` refuses when `expectedVersion` or `headRevisionId` is missing.
- Integration tests before the change, since the save machinery refactor is parked:
  - a stale room reconnecting after an external edit
  - the sibling write failing
  - Drive changing between the check and the write
