---
name: gmist-review
description: Read, review or edit a live gmist document or shared room as a participant. Use when Steve gives a gmist doc or room URL (mist.broad-smoke-cc64.workers.dev/docs/...) and asks to read it, review it, comment on it, suggest changes, make tracked edits, or work on / write / rewrite / edit the markdown directly. Joins the document's live Yjs session over the agent WebSocket, posting CriticMarkup or a direct edit that merges with whoever is typing, rather than overwriting the Drive file.
---

# gmist-review

**House style.** Prose this skill writes for a human reader is a deliverable. Apply the Writing Rules in `C:\Users\Zoom\.claude\CLAUDE.md` before saving or sending. Those rules do nothing unless the prompt asks for them (measured 5 September 2026), which makes this line the switch. Detail in memory `reference_testing_hub_rules`.

Read and contribute to a live gmist document as a real session peer, via
`scripts/gmist-bot.mjs` (the canonical client; do not reimplement its protocol).
Run it from `C:\dev\mist`. Steve gives a doc URL; you fetch the body, decide on
changes, and post them either as CriticMarkup that he accepts or rejects in the
editor (the Procedure below, the default for review) or as a direct edit (the
Direct edits section, when he asks you to write or rework the text itself).

## Auth (once)

A shared room (a document without a Drive file, made from the gmist home page)
needs only its link, without any cookie. A Drive document needs the `mist_session`
cookie. The client reads `scripts/.gmist-session` (gitignored) automatically, so normally you need nothing. If a run prints
`error: Unexpected server response: 401`, the cookie has expired: ask Steve to
copy a fresh `mist_session` value from a signed-in browser (DevTools > Application
> Cookies) into `scripts/.gmist-session`. Never print or commit the cookie.

## Procedure

1. **Read the body** (read-only; always do this first, the edits anchor to it):
   ```bash
   timeout 15 node scripts/gmist-bot.mjs "<doc URL>"
   ```
   It prints the body between `----- body -----` markers. Read-only mode does not
   exit, so always wrap it in `timeout` (an open socket bills Durable Object time).

2. **Decide the edits.** You are the reviewer: reason about the body and choose
   CriticMarkup operations. Write them to `_tmp/edits.json` as an array, each
   anchored by a literal `find` substring of the current body (keep `find` long
   enough to be unique):
   ```json
   [
     { "op": "comment",     "find": "the opening line", "text": "tighten this" },
     { "op": "replace",     "find": "teh report",       "replace": "the report" },
     { "op": "insertAfter", "find": "conclusion.",       "text": " Add a caveat." },
     { "op": "delete",      "find": "very " }
   ]
   ```
   `replace`/`delete` render as `{--old--}{++new++}` / `{--old--}` (additions and
   deletions); `comment` with no `find` appends `{>>text<<}` at the end.

3. **Apply** them:
   ```bash
   timeout 20 node scripts/gmist-bot.mjs "<doc URL>" --edits _tmp/edits.json
   ```
   It prints each op's outcome (`replace ... -> ...` or `SKIP (anchor not found)`)
   and disconnects. A SKIP means the `find` substring was not in the body; fix the
   anchor and rerun only the skipped ops.

4. **Tell Steve** what you posted and that he can accept/reject each change in the
   editor. Re-running the read-only fetch confirms what landed.

## Direct edits

When Steve wants the text itself changed rather than suggested (needs an edit
link; a suggest link is locked to suggest mode in the editor, so use the
Procedure above with it):

1. `timeout 20 node scripts/gmist-bot.mjs "<doc URL>" --get _tmp/doc.md` saves
   the body to `_tmp/doc.md` and a copy to `_tmp/doc.md.base`.
2. Edit `_tmp/doc.md` with the Edit tool.
3. `timeout 20 node scripts/gmist-bot.mjs "<doc URL>" --put _tmp/doc.md` applies
   it as one minimal diff, so anyone typing keeps their edits and cursor, then
   reads the body back over HTTP and confirms it matches.
   - A `refused` means someone edited since the get: their text is in
     `_tmp/doc.md.theirs`. Merge it into `_tmp/doc.md`, copy `.theirs` over
     `.base`, and put again. Never delete the `.base` to force a write.

## Quick note

For a single appended comment with no review pass:
```bash
node scripts/gmist-bot.mjs "<doc URL>" --suggest "a quick note"
```

## Notes

- The edit is attributed to the cookie's Google identity (currently Steve's), not
  a separate bot account. Fine for solo use; a shared deployment would want its
  own identity on the file's Drive ACL.
- Anchors are located in the body at apply time, one op at a time, so later ops
  see earlier ops' text. Order ops so a `find` is not destroyed by an earlier op.
- This edits the body only. Comment threads form when a human client renders the
  `{>>...<<}` text (gmist's `useTextThreads`), so a thread appears once Steve's
  editor is open on the doc.
