# Plan: live collaboration on a shared Drive folder (Drive default, GitHub preserved)

Status: design agreed in discussion, 12 June 2026. Supersedes `live-sync-obsidian.md` (which proposed a background desktop sync agent; we rejected that, see below). Builds on the shipped work in `secret-links-and-github.md`. No code until the build order here is agreed.

## Goal

Steve and a colleague collaborate on the markdown files in a shared Google Drive folder: live cursors, live preview, per-user edit or suggest, from a web link. The files stay in Drive as the single source of truth, edited by Obsidian or any other text editor the rest of the time and kept in sync by Drive as now. Nothing runs in the background on anyone's desktop. Access follows Drive permissions, with a secret link as a fallback for outsiders. GitHub stays available as a second backend, but Drive is the default for about 90% of use.

## Decisions taken (departures from the old plan)

- **Cloud bridge, not a desktop agent.** The old plan bound a local file to the relay with a background Node process. That breaks the moment the machine is off (Steve on holiday, colleague wants to edit). Instead the always-on relay reads and writes the Drive file directly through the Drive API. Holiday-proof, and it matches the machine-independence rule rather than fighting it.
- **Drive is the default backend; GitHub is preserved as a second one.** The import and commit-back GitHub mechanism already built stays, behind the same editor and links. No immediate need, but kept.
- **Plain-text document core.** Move the CRDT from a ProseMirror `XmlFragment` with marks to a single `Y.Text` of markdown plus inline CriticMarkup. This is what makes the bridge's text-diff-to-CRDT merge tractable, and it serves both backends, since each one just persists markdown text.
- **Auth by Drive permission, secret link as fallback.** Google sign-in (email only), and the relay checks that email against the file or folder's Drive sharing list. Secret links remain a single-file capability for people not in the Drive ACL.
- **Folder sidebar on the signed-in path only.** Drive gives siblings and parent for free, and folder access inherits, so one folder share unlocks navigation. Secret-link holders stay scoped to their one file.
- **Idle auto-close.** Sessions close after inactivity, flushing final state; the page shows a read-only banner with a Resume button. This sits on top of the merge guard, it does not replace it.

## Why build it rather than use an existing tool

Assessed June 2026. Peerdraft (GPL, has a web link and cursors, but persistence is paid, no self-host, and no suggesting) and Relay (MIT, self-hostable, but Obsidian-only with no web editor and no suggesting). Neither does suggesting and neither fits the Drive-permission model, so we build the web half on mist's own MIT backend.

## Architecture (layers)

1. **Document core.** One `Y.Text` of markdown plus inline CriticMarkup. The web editor renders CriticMarkup delimiters as styled suggestions over plain text, with a per-user Edit/Suggest toggle (the link role sets the ceiling).
2. **Relay.** The existing Cloudflare Durable Object: live authority while editing, persists Yjs to SQLite, relays sync and awareness. Adds the cloud-bridge logic and the idle alarm.
3. **Backend abstraction.** One interface, two implementations:

   ```
   interface DocBackend {
     read(ref): { text, version }                  // version = Drive etag or GitHub sha
     write(ref, text, version, msg): { version }    // conditional on version; rejects on mismatch
     list?(folderRef): Array<{ name, ref, isFolder }>   // Drive only
     parent?(ref): folderRef | null                     // Drive only
     canAccess?(ref, userEmail): boolean                // Drive only
   }
   ```

   - `DriveBackend` (default) implements all of it through the Drive API.
   - `GitHubBackend` (preserved) implements `read` and `write` only. It is the `fetchPublicText` plus `fetchSha` plus `commitFile` helpers already shipped, refactored behind the interface. Folder navigation and Drive auth do not apply to it; it keeps secret-link auth.

4. **Cloud bridge** (in the relay):
   - On write: serialise the `Y.Text` and call `write(ref, text, version)` conditionally. If the backend reports the file changed underneath (Drive 412, GitHub sha mismatch), re-read and diff-merge rather than overwrite. This is the guard the current commit-back lacks.
   - On external change: poll the backend (Drive `files.get` etag, or the changes feed) every few seconds. When the file has moved, read it and diff-merge into the `Y.Text` with diff-match-patch as positioned inserts and deletes, so an editor's save and the live edits combine instead of clobbering.
   - Normalise line endings and trailing whitespace before diffing, so a CRLF-versus-LF editor or an "add final newline" setting does not look like a real edit.

5. **Auth.**
   - Google sign-in returns the user's email (a non-sensitive scope: no Drive consent, no Google restricted-scope verification).
   - The relay calls `canAccess(ref, email)` (Drive `permissions.list` on the file or its folder) and admits edit or suggest by what the ACL and the link role allow.
   - Secret links keep working unchanged for outsiders: one file, no sidebar.

6. **Folder sidebar.** For signed-in users: `list(parent(currentFile))` shows siblings and subfolders, with a step up to the parent. Clicking a file opens or lazily creates its room, seeded from the backend file, gated by the same `canAccess` check. Drive's permission inheritance is the navigation boundary: you cannot go above the shared folder, because the check fails there.

## Access model

| Caller | How they get in | Scope |
|--------|-----------------|-------|
| Signed in, in the Drive ACL | Google sign-in, ACL check | Every file in the folders they can access; full sidebar |
| Secret edit link | `?k=editKey` | That one file, edit |
| Secret suggest link | `?k=suggestKey` | That one file, suggest only |

Two bonuses from the signed-in path: real names on cursors, and access that tracks the Drive ACL live, so unsharing in Drive makes the next join or resume fail.

## Conflict and merge rules

- The relay is the live authority while a session is open.
- Every write is conditional on the version token. A stale write is rejected and retried as a merge, never a clobber. This is what removes the "forgotten window overwrites a later edit" risk.
- External edits arrive by polling and merge by text diff at file-save granularity (a second or two), which is fine for staying in sync.
- Idle sessions close and flush, shrinking the window where two surfaces are both live.

## Idle auto-close

- Reset a last-activity stamp on each edit. An alarm (the same mechanism as the removed 99-hour expiry) fires after the idle threshold, flushes final state to the backend, and closes connections.
- The client drops to read-only and shows a banner with a Resume button (reuse the `OnboardingBanner` and `SaveStatus` patterns). Resume reopens the socket, which re-runs the key and Drive-permission check and re-syncs the latest state.
- Default threshold 20 to 30 minutes. Because we flush continuously, nothing is unsaved at close.

## Reuse versus build

Reuse, shipped and verified: the Durable Object relay and its SQLite persistence, secret edit and suggest links, the CriticMarkup parser, serializer and rendering, the Cloudflare deploy, and the GitHub read and write helpers, which become `GitHubBackend`.

Build: the plain-`Y.Text` document core and the editor changes for it; the `DocBackend` interface and `DriveBackend`; the cloud-bridge write-guard, polling and diff-merge; Google sign-in and the ACL check; the folder sidebar; idle auto-close and the resume banner.

## Build order

1. **Document core to plain `Y.Text` plus CriticMarkup**, with a per-user Edit/Suggest toggle. Prove live multi-client web editing and suggesting on the new core, and refactor the existing GitHub path onto `DocBackend` so nothing regresses.
2. **`DriveBackend` read and write**, plus the cloud-bridge write-guard and polling diff-merge. Prove a Drive file round-trips: open it from Drive, edit on the web, see it land in the Drive file and back out to a desktop editor; edit in the desktop editor, see it merge into the web doc.
3. **Google sign-in and the ACL check.** Prove a colleague in the share gets in, one who is not is refused, and the secret link still works as fallback.
4. **Folder sidebar:** siblings, parent, lazy room open, bounded by the ACL.
5. **Idle auto-close and the resume banner.**

Each step is web-testable in the same fast loop that built the current app.

## Open decisions

- **Drive credential for the relay.** Decided 12 June 2026: use Steve's stored OAuth refresh token, so files stay owned by Steve and edits attribute to him. The service-account alternative (tidier server-side, but needs the folders shared with it and writes show as the service account) is not used. Secrets needed, names only, as Worker secrets alongside the existing `GITHUB_TOKEN`: the Google OAuth client id and secret, and the Drive refresh token.
- **External-change detection:** a few-second poll first, with Drive push notifications to a Worker webhook as a later refinement.
- **Idle threshold:** exact value.
- **Attribution:** all Drive writes show as the relay's identity, Steve or the service account, not the individual colleague. Acceptable, noted.

## Effort

The foundation (relay, links, CriticMarkup, deploy, GitHub helpers) is built and working. The real work is the plain-text core rewrite and the cloud bridge (write-guard, polling, diff-merge), with sign-in and the sidebar as bounded additions on top. Several focused days, low architectural risk because nothing underneath is speculative; the one fiddly routine is the text diff-merge.
