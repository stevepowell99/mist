# Builds fail about one run in three with "The WebSocket is undefined"

- Seen 26 November 2026: 2 of 5 `npm run local:refresh` builds failed, and each passed on the next run with no code change.
- The client build logs "new dependencies optimized: react-router, agents, react, @codemirror/view ... optimized dependencies changed. reloading", then the SSR build fails in `react-router:virtual-modules` with `AssertionError: The WebSocket is undefined` from `@cloudflare/vite-plugin/src/cloudflare-environment.ts:60` (Vite's optimiser trying a full reload during a production build).
- `npm run deploy` runs the same build, so a deploy can fail the same way; `local-gmist.mjs refresh` leaves the old build running when it does, which is safe but easy to miss.
- Also seen once: the restarted gmist took more than the refresh script's 60 s to answer on a loaded machine, so the script reported failure although the restart worked.
- Next: find why the optimiser runs during `react-router build` (an `optimizeDeps` setting, or a dependency cache that a worktree's `npm install` invalidates) and stop it there, rather than adding a retry.
