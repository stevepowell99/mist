# Library images do not load in local mode

A deck image written as `drive:<fileId>` (what the library gallery inserts) never loads in local gmist. Relative images do, since `bc1d0ef`.

Why, from reading the code (not tested against a running server):

- `resolveAssetSrc` rewrites `drive:<id>` to `/drive/asset?id=…`, but id-mode in `app/routes/drive.asset.ts` calls `driveGetMeta`, which in local mode goes to the localfs backend. That backend only understands `lf_` path ids, so a real Drive id fails (502, or 403 from `isInLibrary`).
- `isInLibrary` would fail even if the lookup worked. `libraryRoot` defaults to the Drive folder id `DEFAULT_LIBRARY_FOLDER_ID` in `library.server.ts`, which a walk over local ids can never match.

What a fix needs:

- A local library root, for example `LOCAL_LIBRARY_PATH` turned into an `lf_` id by `libraryRoot`, with `isInLibrary` working on local ids.
- A way to turn the Drive id embedded in a deck into a local path. Either an index from Drive id to mirror path, or library-relative paths in place of `drive:` refs, which changes the deck format.
- Or let local mode call real Drive for id-mode only. That reintroduces the Google secrets and network access local mode avoids.

Workaround meanwhile: use a relative path to the library file. The asset route tries the path from each folder above the deck in turn, for example `19d-slides-and-images/images/<file>.png`.

Found 2026-10-19 while fixing the EES2026 mosquitoes deck.
