# Chord registry: finish the proof in the other two modes

- Context: commit 345d18a moved every Ctrl/Cmd+Alt shortcut onto `app/lib/chord.ts` (`useChords`); checked in the running local gmist only (D, Ctrl+Alt+1 from the deck, local Help list)
- To do
  - Open a Drive-bound document and an unbound room on the deployed worker; press the chords from the editor and from a deck preview (D, Ctrl/Cmd+Alt+1, +G, +J, +M); confirm Help lists what works
  - Record the modes proved in the next commit message, per the charter's aim
- Separate: `tests/unit/lib/live-preview-image.test.ts` (broken image) failed in two full suite runs and passed alone, under a parse-time budget; make it independent of machine load
