# Plan: live Obsidian sync (superseded)

Superseded 12 June 2026 by [`live-collab.md`](live-collab.md).

This earlier draft proposed a background desktop sync agent binding a local file to the relay. We rejected that because it ties the whole system to one machine being switched on (a colleague cannot edit while Steve is away). The replacement keeps the same live-CRDT idea but moves the bridge into the always-on relay, which reads and writes the Drive file directly, and makes Drive the default backend with GitHub preserved. See `live-collab.md` for the agreed design.
