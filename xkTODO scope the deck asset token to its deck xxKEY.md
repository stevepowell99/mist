# Scope the deck asset token to its deck

Found 28 October 2026, while putting public view links to the two EES 2026 decks on causalmap.app.

## The fault

The asset token that "Copy public view link" puts in a deck's `/slides/:id` link is a coarse Drive key, not a read-only key for that deck.

- `driveAccess` treats a valid asset token as a session without an email (`app/lib/drive-access.server.ts`, the `verifyAssetToken` branch).
- Without an email, `canAccessFile` returns true for any file and `fileAccessRole` returns `"edit"`, so every per-file sharing check is skipped.
- `openDriveRequest` admits the token on every `/drive/*` route, including `drive.op`, `drive.search`, `drive.upload`, `drive.import`, `drive.library-save` and `open`.
- So for six hours (`ASSET_TTL_SECONDS` in `app/lib/session.server.ts`) whoever holds a public view link can search, read and operate on any file gmist's Drive connection reaches.
- `deckViewLink` in `app/components/ShareButton.tsx` puts this token in every public view link, and `slides.$id.tsx` reads it from the URL, so the link also stops loading the deck's images and theme six hours after it was copied.

## The fix

- The slides page mints its own token when the doc key is valid (`mintAssetTokenForDoc` already exists), and `deckViewLink` stops carrying `token`. A public link then carries only the doc key and never goes stale.
- The token names its deck, and only `/drive/asset` (and `/drive/bib` if the deck needs it) accepts it, resolving only files under that deck's Drive folder. `driveAccess` stops treating it as a session anywhere else.
- Check that the in-app deck preview, which mints its token from the signed-in session, still loads its assets.

## Exposure so far

Two tokens went out on the public causalmap.app EES 2026 page (commit `b43aa90` in the public repo `causalmap-site-prototype`) and were removed in `309a8b6` about forty minutes later. Both expire at 13:24 UTC on 28 October 2026. Every public view link copied before the fix carries a token of the same kind.

Once this is deployed, the two links on that page (`/slides/ngfo3qdn`, `/slides/omitjwki`) load their images and theme again, and the page itself does not need to change.
