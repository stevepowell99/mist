Local gmist's "(unsaved YYYY-MM-DD HHMM)" recovery copies pile up beside documents. Steve, 20 November 2026: "gmist is always doing that".

- Measured 20 November 2026 (Everything search `"(unsaved 20"`, 25 found, 25 read)
  - 3 identical to their original, line endings normalised: deleted the same day
  - 13 differ: `report-for-jo` four times in 12 minutes on 16 November (each also copied into two `causal-map-extension` worktrees), and Causal Map AGM 2026 on the shared drive
  - 9 already moved by hand into `_tmp` backup folders
  - they come in bursts: 4 in 12 minutes (16 November), 4 in 40 minutes (19 November, the Instats deck), 5 in one afternoon (14 September, rubicon-site home)
- Likely trigger, not verified: a Claude session writing the file while Steve has it open in local gmist with unsaved edits. The 19 November burst came while a session was editing the Instats deck
- What the code does
  - `raiseConflict` (`app/components/PlainEditor.tsx`) writes a copy as soon as the file moves under unsaved edits, then freezes the buffer
  - `takeDisk` in the same file writes another copy before taking the disk version, though the frozen buffer cannot have changed since the first: always a duplicate
  - `app/routes/local.recovery.ts` writes whatever it is sent, even text that matches the file on disk
  - gmist does not delete a copy once the clash is settled
- Fix, to agree with Steve before building
  - `takeDisk`: keep the copy `raiseConflict` wrote; write one only if none exists
  - skip the copy when the buffer matches the disk version, line endings normalised
  - once the clash is settled, offer to delete the copy where the disk version already holds everything in it
