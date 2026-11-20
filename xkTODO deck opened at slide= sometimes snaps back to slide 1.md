# Deck opened at ?slide=N sometimes snaps back to slide 1

- Seen 20 November 2026 on the live worker, in a fresh browser on a new unbound room, in Preview and in Split: twice in three loads.
  - Messages from the deck: `mist-need-goto`, then `mist-slide` 2, then `mist-slide` 0 about 80 ms later.
  - The third load stayed on slide 2, so it is a race.
- Likely cause, not yet confirmed: `SlidesView` calls `sendInitialGoto` twice on a load, once for `mist-need-goto` and once from the iframe's `onLoad`.
  - The first call restores `?slide=` and sets `restored`.
  - The second call then sends the cursor's slide (0 on a fresh load), which undoes the restore.
- Possible fix: while a `?slide=` was restored and the cursor has not moved (`cursorMoved`), resend the restored slide, not the cursor's.
- Not caused by the hidden-slide or Comment on slide commits (`2a77665`, `1808b79`); that code is unchanged.
