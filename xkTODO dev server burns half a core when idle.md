# Dev server burns about half a core while idle

Found 2026-08-20. A `npm run dev:local` session started on 18 August at 12:03 and left
running used 23.8 hours of CPU over 51 hours of wall clock, roughly 0.47 of a core,
sustained, with nobody using the browser or editing a file. The laptop ran hot for two
days. Killing the tree fixed the heat.

An idle Vite watcher should sit near zero, so something is polling rather than waiting.
Worth checking, in this order:

- The Cloudflare vite plugin and its workerd child, which is the part of this stack least
  like a plain Vite dev server.
- Whether chokidar has fallen back to polling. `usePolling` on a local NTFS path would
  explain a steady burn exactly like this one.
- Whether anything under `node_modules` or the vendored pagedjs output is being watched.

`devstop` (pwsh) lists local dev servers with their age and CPU burn, and a SessionStart
hook in the hub reports any that have been running more than eight hours, so a repeat will
be visible rather than found by touch.
