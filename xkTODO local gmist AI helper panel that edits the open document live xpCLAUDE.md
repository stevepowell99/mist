# Local gmist AI helper that changes the open document live

- Asked by Steve, 25 November 2026: "on local gmist, add a helper just like mapcat / qworkshops / QualiaInterviews which can change the text live"
- State: nothing built or committed yet; the first session only surveyed and got the design agreed. Steve said "Yes, as recommended" to both decisions below.
- Decisions made
  - Model route: headless `claude -p` on Steve's subscription, started by the local file server (the sidecar, `scripts/localfs-server.mjs`), reached the way the Commit button is. Local gmist only; no API key, no real money
    - Timed: 5 s for a one-word reply with `--setting-sources "" --no-session-persistence --tools ""` and `CLAUDE_HUB_DOC_SWEEP=1`; expect 10 to 30 s a turn on a long document
    - Rejected for now: Claude on Vertex through the deployed worker (works online and for Gabriele, can stream, but costs real money and needs a secret, a spend cap and an edit-link abuse check)
  - Edits apply at once as ordinary CodeMirror transactions (so Ctrl+Z, autosave and the conflict guard work), each change highlighted, with a diff card under the reply and an Undo button; in Suggesting mode they arrive as tracked changes (`app/lib/cm-suggest.ts`)
  - Each edit finds its passage by exact text in the document as it stands when the reply arrives; if the passage has changed meanwhile, skip it and report it
- UX to match (surveyed from MapCat, Qualia Workshops' Assistant and the QualiaInterviews Advisor)
  - Opens from a button, closes with Escape, Enter sends, Clear button, no streaming (a "thinking" line), proposed changes in a card under the reply; the Advisor's diff card is the closest model
  - Panel on the right like the comments panel, opened by a toolbar button and a chord registered in `app/lib/chord.ts` (check it against the Help list)
- First step planned: a pure edit-planning module with unit tests (`tests/unit/lib/`), then the panel (`app/components/`), the sidecar route, the chord, Help entry
- Read first: `CLAUDE.md`, `docs/technical-architecture.md` (Editor and preview), `docs/design-system.md`
- Related: the Live view slide-component fix runs in its own session and worktree (`C:\dev\mist-live-reveal`, branch `live-reveal`); deploy it together with this once both are on `main`
