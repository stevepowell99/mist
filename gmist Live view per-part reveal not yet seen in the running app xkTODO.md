# gmist Live view per-part reveal: not yet seen in the running app

- Commit `4804ceb` on `origin/main` (25 November 2026): in a deck's Live view, the slide holding the cursor shows as source only for the part under the cursor; other `:::` divs and raw HTML blocks (cards, callouts, columns, inline SVG) stay drawn.
- Proved: typecheck, full vitest (62 files, 498 tests). Not proved: the running app, in any room mode (Drive-bound, unbound, local-fs).
- Files: `app/lib/cm-live-preview.ts` (`slideParts`), `app/lib/slides-build.ts` (`divFence`), `app/app.css` (`.cm-lp-part`), `docs/technical-architecture.md`, tests `live-preview-slide-parts.test.ts` and `live-preview-parse.test.tsx`.
- Checks once deployed (Live view is Ctrl/Cmd+Alt+4):
    - cursor on a slide's prose: its cards, callouts and inline SVGs stay drawn. **Seen working** in local-fs mode, 25 November 2026 (a card and an inline SVG stayed drawn, the next slide stayed a whole card)
    - cursor in one column of a two-column slide: the other column stays drawn. Not yet seen
    - click a drawn part after typing above it: the cursor is placed in that part's source. Seen only without typing above it first (clicking the card showed its source and left the SVG drawn)
    - the Drive-bound and unbound editors: not yet opened
- Delete this file once the three checks have been seen working.
