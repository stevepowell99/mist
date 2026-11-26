# gmist drawing code folded by default: not yet seen in the running app

- What: inline `<svg>`, `<style>` and `<script>` blocks and diagram fences (mermaid, `dot`, `graphviz`) open folded in every View of both editors; ordinary code fences stay open. Asked for by Steve, 25 November 2026.
- Proved: typecheck, full vitest (67 files, 545 tests). Not proved: the running app, in any mode (Drive-bound, unbound, local-fs). Needs `npm run deploy`, which is Steve's call.
- Files: `app/lib/cm-folding.ts` (`drawingFolds`, `foldOnLoad`), `app/lib/html-tags.ts` (`closeTagEnd`), `app/lib/mermaid.ts` (`MERMAID_START` exported), `app/lib/cm-live-preview.ts`, `docs/technical-architecture.md`, tests `cm-folding.test.ts` and `cm-folding-load.test.tsx`.
- Checks once deployed:
    - open a deck or document holding an inline SVG and a mermaid fence, in Editor view: both show one line with the fold marker; a python fence stays open. **Seen working** in local-fs mode, 26 November 2026 (Source view of a document with all three)
    - in a room opened cold (the text arrives after the editor): the same folds appear
    - in Live view, put the cursor on a slide's SVG line: its source shows folded; click the marker to open it
    - unfold a block and type elsewhere: it stays open
- Delete this file once the checks have been seen working.
