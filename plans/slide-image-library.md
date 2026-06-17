# Plan: reusable slide and image library (drop-in gallery)

Status (17 June 2026): Phases 1 (slides), 2 (images) and 3 (from a deck) shipped,
plus a name+full-text search box and Phase 4's save-to-library. Remaining Phase 4
polish: live (Phase B) thumbnails, and rewriting a picked deck slide's relative
images to `drive:<id>`. To switch the library on, set the `LIBRARY_FOLDER_ID`
worker var to a Drive folder holding `slides/` and `images/` subfolders. Files:
`app/lib/library.server.ts`, `app/routes/drive.library.ts`,
`app/routes/drive.library-save.ts`, `app/routes/drive.fragment.ts`,
`app/components/LibraryGallery.tsx`, the `deckSlides()` splitter in
`slides-build.ts`, id-mode in `drive.asset.ts`, the `drive:<id>` scheme in
`asset-urls.ts`, and `fullText` search in `google.server.ts`/`drive.search.ts`.

## Goal

Bring back the old `19c-slides` "drop in a standard slide or image" workflow, but
Drive-native. From inside a gmist deck, open a gallery, browse a curated set of
standard slide fragments and standard images, click one, and it is inserted at
the cursor. Reusable across every deck, not tied to one folder, and curated from
Drive/Obsidian without touching the worker.

## Principle

The library is **one canonical Drive folder**, not a bundled-app asset. gmist
already enumerates Drive (`drive.search.ts`), serves private Drive assets
(`drive.asset.ts`), and uploads (`drive.upload.ts`). The gallery is a thin UI
over those. This keeps it Drive-only, single-source-of-truth, and editable
outside the app.

## What already exists (reuse, do not rebuild)

- `app/routes/drive.search.ts`: list a folder's children / name-search, with
  breadcrumb trail and `types` filter. Returns `SearchResult[]`.
- `app/routes/drive.asset.ts`: stream a Drive file (image/css/font) through the
  relay identity, gated by session or signed asset-token. Currently resolves a
  path relative to the deck's own folder.
- `app/lib/asset-urls.ts`: `resolveAssetSrc` / `rewriteImages` turn a markdown
  image src into a tokened `/drive/asset?...` URL at render time, for both
  Preview and the slides iframe. The saved markdown keeps a clean reference; the
  token is injected only at render.
- `app/components/CodeMirrorEditor.tsx`: image paste already uploads to Drive
  and inserts `![](path)` via `view.dispatch`. Same insertion mechanism the
  gallery will use.
- `app/lib/cm-slash.ts`: slash menu, a natural entry point for the gallery.
- `app/lib/google.server.ts`: `driveKind`, `KIND_CLAUSE`, `driveFiles`,
  `driveDownload`, `driveGetMeta`.

## The one real architectural gap

`drive.asset` only resolves a path against the current deck's folder, so a
shared library that lives elsewhere is unreachable, and a deck-relative path is
meaningless once the same image is reused in a deck in a different folder.

Fix: reference shared-library assets by Drive file **id**, not by path.

### Stable markdown reference

The inserted, saved markdown must be a stable reference with no token and no
expiry (it round-trips through Drive). Use a custom `drive:` scheme:

```
![alt](drive:<fileId>)
```

`resolveAssetSrc` recognises `drive:<id>` and emits
`/drive/asset?id=<fileId>&token=<assetToken>` at render time, exactly as it does
for relative paths today. The file stays clean and portable across decks.

Tradeoff to accept and note: a `drive:<id>` reference shows nothing in a plain
markdown viewer (Obsidian, a local preview). That is acceptable because a
shared-library image has no portable local path anyway; a deck's own pasted
images keep using relative paths and stay locally viewable. Document this in
`CLAUDE.md` when shipped.

## Server changes

### 1. `drive.asset.ts`: id-mode

Accept `id` as an alternative to `deck`+`path`:

- If `id` present: run the same `driveAccess` gate, then enforce two constraints
  before download (id-mode must not become a read-any-Drive-file endpoint for any
  session/token holder):
  1. The file's mime type is an image (reuse the `MIME` map / a new image kind).
  2. The file lives within the configured library folder subtree (check
     `driveGetMeta(...).parents` against `LIBRARY_FOLDER_ID`; one hop is enough
     if the library is flat, walk parents if nested).
- Then `driveDownload(token, id)` and stream with the right mime.
- Keep path-mode untouched.

### 2. `google.server.ts`: an `image` DriveKind

- Add `image` to `DriveKind` (line ~305).
- `driveKind`: `if (mimeType.startsWith("image/")) return "image"`.
- `KIND_CLAUSE`: `image: "mimeType contains 'image/'"`.
- Add `image` to `FILTERABLE` in `drive.search.ts` so the gallery can request it.

### 3. Library config (single source of truth)

- `LIBRARY_FOLDER_ID` worker var (the canonical standard-library folder).
- Optional per-deck override via frontmatter `library: <folderId or path>` for a
  deck that wants its own set, resolved the same way `css:`/`bibliography:` are.
- Layout (settled): one library folder with two subfolders, `slides/` for `.md`
  fragments and `images/` for image files. `LIBRARY_FOLDER_ID` points at the
  parent; gmist resolves the two subfolders by name under it.

### 4. Fragment read endpoint

Slide fragments are `.md` files; the gallery needs their text to insert. Reuse
the existing markdown read path (`drive.import.ts` / `drive.op.ts`) behind a
small `GET /drive/fragment?id=<id>` (or extend `drive.op`), returning raw
markdown. Gate by the library-subtree check as above.

The same endpoint serves "insert one slide from an existing deck" (see 8): it
returns the full deck markdown by id, and the client splits it into per-slide
raw markdown. For the deck-source case the subtree check is relaxed: any deck the
caller can open is a valid source (it is markdown, not a binary asset, and the
caller already has access to it), so gate that path by `canAccessFile` on the
deck id rather than the library subtree.

## Client changes

### 5. Gallery picker component

`app/components/LibraryGallery.tsx`, opened from a toolbar button and a slash
command (`/library`, or `/slide` and `/image`). Three tabs:

- **Slides**: `drive.search` scoped to the library `slides/` folder,
  `types=markdown`. Each item: a thumbnail (see below) plus name. Click inserts
  the fragment markdown.
- **Images**: `drive.search` scoped to `images/`, `types=image`. Each item: an
  `<img>` thumbnail via `/drive/asset?id=...&token=...`. Click inserts
  `![](drive:<fileId>)`.
- **From a deck** (see 8): pick any existing deck via `drive.search`
  (`types=markdown`, browsable beyond the library), then choose one slide from
  it to insert.

Insertion: `view.dispatch({ changes: { from, to, insert }, ... })` at the
selection, mirroring `CodeMirrorEditor` image paste. In suggest mode the inserted
text is wrapped as a CriticMarkup addition like any other edit (reuse the suggest
path so this is automatic).

### 6. Slide-fragment thumbnails (two phases)

- **Phase A (cheap):** render a text card, the fragment's first heading / first
  line plus small badges for the component/colour classes it uses (parse the
  `:::` fences). Fast, no iframe.
- **Phase B (rich):** lazy live-render each fragment through `slides-build` into
  a small scaled iframe, only when the item scrolls into view / on hover. Reuses
  the real renderer so the thumbnail matches the result.

Start with Phase A.

### 7. `asset-urls.ts`: recognise `drive:<id>`

In `resolveAssetSrc`, before the relative-path branch:

```
const m = path.match(/^drive:(.+)$/);
if (m && ctx.driveToken) return `${ctx.origin}/drive/asset?id=${encodeURIComponent(m[1])}&token=${encodeURIComponent(ctx.driveToken)}`;
```

So Preview and slides both resolve library images. Confirm the asset-token path
(`email:null`, coarse access) still passes the new library-subtree check in
id-mode (it should: the subtree check is independent of identity).

### 8. Insert one slide from an existing deck

Not every reusable slide will be pre-curated into `slides/`; often you want a
single slide out of a standard deck you already have. The "From a deck" tab:

1. Browse/search decks with `drive.search` (`types=markdown`, not restricted to
   the library, since the source is any deck the caller can open).
2. On selecting a deck, fetch its full markdown via the fragment endpoint (4),
   gated by `canAccessFile` on that deck id.
3. Split it into per-slide raw markdown. Reuse the slide-delimiter logic that
   `slides-build` already uses to cut sections (factor the splitter out so the
   client gets `{ index, rawMarkdown, firstLine }[]` rather than built HTML).
   The split must return the original markdown slice per slide, not rendered
   output, so the inserted slide carries its real source.
4. Show each slide as a thumbnail (same Phase A / Phase B treatment as fragments)
   and insert the chosen slide's raw markdown at the cursor.

A picked slide may reference deck-relative images that will not resolve in the
target deck. For v1, insert the markdown as-is and note this limitation; a later
pass can rewrite such `![](rel)` images to `drive:<id>` by resolving them against
the source deck's folder at pick time (reusing `driveResolvePath`).

## Phasing

1. **Slides-only, no asset work.** Config (3) + fragment read (4) + gallery
   Slides tab (5) + Phase A thumbnails (6A). Highest value, zero image plumbing.
   "Drop in a standard slide" works end to end.
2. **Images.** id-mode (1) + image kind (2) + `drive:` scheme (7) + gallery
   Images tab (5). "Drop in a standard image" works, reusable across decks.
3. **From a deck.** The slide-splitter factor-out and the "From a deck" tab (8).
   Builds on the fragment endpoint (4) and thumbnails (6) already in place.
4. **Polish.** Phase B live thumbnails (6B); "save current slide/selection to
   library" using `drive.upload.ts` so the gallery grows from inside gmist;
   rewrite a picked deck slide's relative images to `drive:<id>` (8).

## Security note

id-mode is the sensitive change: without the image-mime and library-subtree
constraints it would let any holder of any valid asset-token or session read any
file the relay identity can see. Both constraints are mandatory in step 1, not
optional polish.

## Settled

- Library layout: one folder with `slides/` plus `images/` subfolders,
  `LIBRARY_FOLDER_ID` pointing at the parent.
- Existing full decks are a slide source too: the "From a deck" tab (8) lets you
  insert a single chosen slide from any deck you can open, alongside the curated
  fragments.

## Remaining / open items (as of 17 June 2026)

Library, all DONE 17 June 2026:
- **Multi-select**: a checkbox per result, a select-all/none toggle, and an
  "Insert N selected" action insert several slides/images at once (works on the
  Slides, Images and a picked deck's slides; not the deck-search drill-down list).
- **Upload an image to the library** from the Images tab (`/drive/library-upload`,
  POSTs into the resolved `images/` folder, keeps the original filename).
- **Deck-image rewrite**: picking a deck resolves its relative `![](rel)` images
  to `drive:<id>` once (new `POST /drive/resolve`, gated by `canAccessFile`), so a
  borrowed slide's pictures still resolve in the target deck. Live thumbnails
  (Phase 4B) were already done.
- A library image inserts as a `::: {.scale-75}` block so a beginner resizes it
  by editing the number.

Config/state:
- `DEFAULT_LIBRARY_FOLDER_ID` in `app/lib/library.server.ts` = `1Ud0p8...` (the
  19d folder, with `slides/` and `images/` subfolders, shared with the relay
  `hello@causalmap.app`). The `LIBRARY_FOLDER_ID` env var is an optional override.

Note: the user is actively editing `19c-slides/gmist-examples-deck.qmd` (Drive);
expect live changes there, do not clobber.
