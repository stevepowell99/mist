# Drive editor keeps comments in mist YAML, local editor keeps them inline

Parked by Steve, 24 September 2026. Online commenting is useful, so the threads model stays for now.

The two editors store comments differently:

- The local editor (`PlainEditor`, `/edit/<id>`) treats a comment as text: `{>>note<<}` in the body and nothing else (`0b1b793`).
- The Drive editor (`/docs/<id>`) keeps a Yjs `threads` map and writes it out as the `mist:` frontmatter block. On open it creates a thread record for every inline comment and signs it with the name of whoever opened the file (`useTextThreads.ts`, `reconcile`). Resolving a comment deletes it from the text and keeps it only in the YAML (`resolveThread`).

Seen on `CausalMap_Proposal_GetFurther_Wales_GCSE.md`: Gabriele's session in the Drive editor on 23 September 2026 wrote 17 threads. Comments beginning "SP:" were signed "GC" and all timestamped within a millisecond. Of the 17, 14 were resolved and now exist only in the YAML.

Why it is a sync cost: the `mist:` block is where the editor's own text and the file stop matching. That is why the body-only comparison, the phantom "Saving" on open and the frontmatter re-emit (`aa34555`) had to be fixed. It also underlies the parked save/dirty item in `CLAUDE.md`.

The option if it is revisited: comments become text in the Drive editor too. Resolving one deletes it, nothing is created on open and no `mist:` block is written. Existing blocks are read and left alone. That costs replies, authors and resolved history online. A middle path would keep replies and resolve in the Yjs map but not write them to the file, which loses them when the room is gone.
