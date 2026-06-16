# Handover: session of 16 June 2026. READ FIRST.

Live worker is current with `main` (last app deploy was the `bibliography:`
change; the only later commit is a docs/plan file). Working tree is clean. All
work is committed in focused chunks on `main`. Deploy with `npm run deploy`;
deploy does NOT commit. Commit messages end with the Co-Authored-By line.

## What shipped this session (all on main, deployed)

Slides preview
- In-place rebuild is a full reveal `destroy()` + `initialize()` on the swapped
  markup (not `md.init`, which inflated the slide count). Fast, same slide list
  as a fresh load. `slides-build.ts` `rerender()`.
- No cover-slide flash: an opaque waiter overlay covers the deck from first
  paint; the deck reveals only after it has jumped to the right slide
  (`showDeck`). On rebuild the deck is hidden (visibility) during destroy/init.
- Open handshake: the iframe asks the parent for its opening slide when ready
  (`mist-need-goto`), more reliable than pushing on iframe load.
- First-render-never-dropped: renders that arrive before reveal is ready are
  buffered and drained (`pendingRender`/`drainRender`); the parent also re-posts
  on the handshake if content changed during boot. Fixed the blank-until-reload.
- Cursor-follow no longer yanks a `?slide=N` deck back to slide 0: it holds until
  the user actually moves the cursor (`cursorMoved` in `SlidesView`).
- WYSIWYG clip: every leaf slide stretched to the 1280x720 stage with
  `overflow:hidden`, so the narrow-preview letterbox no longer hides overflow
  that gets cut in fullscreen. Letterbox tinted light grey (`.mist-embedded`).
- Dropped the reveal.js-menu plugin (it leaked DOM/listeners across rebuilds and
  slowed the whole page).
- Citations: `[@key]` renders as inline APA and a References slide is appended
  when a bib is loaded (parity with the doc preview). Print route does not pass a
  bib yet.

Editor / layout
- Cursor offset is throttled (~90 ms) so a big deck stays responsive.
- Two RHS toggles: Autosave to Drive (global, persisted), Follow cursor in slides
  (per-file). Follow-cursor off also skips the O(n) cursor->slide scan.
- Split-divider drag: iframe gets `pointer-events:none` while dragging (so the
  cursor crossing it does not stall the drag) and the resize is rAF-throttled.
- Reverse sync (Ctrl/Cmd+Alt+G) scrolls the heading near the top, not the bottom.
- Ctrl/Cmd+Alt+- and = (divider shrink/grow) are now forwarded from the slides
  iframe too.
- Ctrl/Cmd+S (and Ctrl/Cmd+Enter) force a deck rebuild AND a real save.

Save / sync
- Commit-serialisation race fixed (`agents/document.ts` `commitChain`): two saves
  with identical content no longer produce a false `conflict` that latched and
  paused autosave.
- `onConnect` clears the upstream-check throttle so a reload reliably re-reads
  Drive.

Frontmatter (IMPORTANT)
- A tolerant frontmatter regex was tried and REVERTED: it normalised CRLF/fences
  on import, so the seed no longer matched Drive, which triggered an external
  pull whose Yjs update overran the client doc (RangeError) and PROGRESSIVELY
  CORRUPTED yaml docs. `thread-serialization.ts` is back to the strict
  `/^---\n([\s\S]*?\n)---\n\n?/`. Do not loosen the SAVE-path regex again.

Drive / collaborators
- Drive role maps to mist role: writer/owner gets the edit link, commenter/reader
  gets suggest-only (`drive-access.server.ts` `fileAccessRole`, used in
  `drive.import`).
- Assets (CSS/images) now work for a collaborator on the share link with NO
  Google account: the iframe asset token is minted from a valid doc key, not only
  a session (`mintAssetTokenForDoc`). Note the await bug that followed (signed
  token is async) is fixed.
- `bibliography:` frontmatter is honoured: paths relative to the doc folder
  (forward slashes, `..`, exact names), resolved like css/images, tried before
  the folder walk (`drive.bib.ts`, `extractBibPaths`).

Per-file UI settings (`doc-settings.ts`)
- Divider position, view, follow-cursor, clean-view and comments-collapsed
  persist PER FILE (keyed by Drive file id, so they survive re-imports). A new
  file inherits the most-recent layout. Theme and autosave stay global.

Presence (`usePresence.ts`, `PresenceBar.tsx`)
- Avatar row of connected users in the navbar; per-slide peer markers in the
  outline; click an avatar to jump the deck there. Broadcasts the deck slide (or
  cursor slide) over Yjs awareness; ignores remote cursor-only changes.

Class picker
- Built-in reveal/Quarto classes (`.fragment` and effects, `.columns`,
  `.r-fit-text`, callouts) merged into the `.`-picker (`cm-classes.ts`).

Not in this repo: added `.white`/`.black` colours and more `.scale-nn` to
`19c-slides/_shared/styles.css` (the deck stylesheet). Its own commit/publish
flow (`build-site.ps1` hook) was NOT run; do that in that repo.

## Open / parked

- Task #37: harden `replaceBodyFromText` so an external pull can never overrun
  the client doc and desync (the corruption class; latent now that seed == Drive
  again, but worth a guard + full re-sync on any binding error).
- Task #38: strip frontmatter in the DOC preview, DISPLAY-ONLY (a tolerant strip
  in `Preview.tsx`, never in the shared serialization regex). The original
  "preview renders the yaml as a heading" cosmetic bug returned after the revert.
- Class system unification: `plans/class-system.md`. Phase 1 (derive the
  catalogue from the CSS, delete mist's hardcoded HelpPanel/README lists) and
  Phase 2 (arbitrary `left=`/`top=` positioning as parseAttrs attributes) are the
  high-value start.
- Print route: slides citations not wired (print decks get no bib).
- Offered, not built: `bibliography:` accepting a Drive file id (move-proof,
  for a bib in a different folder branch); the user's deck and bib are in
  separate branches so the relative path is `../../19aCMgarden/content/assets/MyLibrary.bib`.
- HelpPanel colour list still omits `.white`/`.black` (drift; folded into the
  class-system plan).

## Workflow rules (in CLAUDE.md)

- Commit in focused chunks directly to `main`; one agent at a time on this tree
  (two sessions share one working tree and will clobber each other / mix
  commits / mix deploys).
- Always deploy to remote after app changes; the deployed worker is the source of
  truth for verification.
