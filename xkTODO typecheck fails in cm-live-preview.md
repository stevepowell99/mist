`npm run typecheck` fails (found 12 November 2026):

- `app/lib/cm-live-preview.ts:455`: TS2345, an `HTMLImageElement` is passed where `string | ReadableStream | Response` is expected.
- GitHub shows no CI runs for the repo, so nothing flags it automatically.
- Done when `npm run typecheck` passes.
