# gmist local helper: check the Drive-bound and unbound navbars once deployed

- The local helper (`ac5fc6a` and its follow-ups, 25 and 26 November 2026) was proved in local-fs mode only: an edit landing and saving, the card's Undo, Ctrl+Z, typing mid-reply kept, Suggesting mode, quotation marks in a reply, and Stop killing the run.
- The Drive-bound and unbound editors pass no `helper` prop to the shared `DocNavbar`, so they should look exactly as before, without the spark button. Local mode has no rooms, so this can only be seen on the deployed worker.
- Blocked on a deploy: `npm run deploy` from a Claude session was refused by the permission classifier on 25 November 2026, so Steve runs it.
- Once deployed: open a Drive file and a shared room on the live gmist and confirm the navbar has the comments button and no spark button; then delete this file.
