# gmist writes "[image not found: …]" into the document when a picture fails to load

Found 2026-09-29 on the Garden page `950 Rubicon/! Checking the claims in an AI report cannot find its omissions.md`. Three of four new `![alt](img/omissions-*.svg)` lines were replaced on disk by the literal text `[image not found: img/omissions-….svg]`, so the markdown image and its alt text were lost. The fourth survived. The files existed in `img/` beside the page throughout. Repaired in the content repo, commit `0c9a3ad`.

## Two faults

- **Data loss (the serious one).** `ImageWidget.toDOM` in `app/lib/cm-live-preview.ts` returns the `<img>` itself as the widget root, and its `error` handler calls `img.replaceWith(span)`. Replacing a widget's root node is a DOM mutation outside the widget, which CodeMirror's DOM observer most likely reads back as typed input, so the fallback text ends up in the document and is saved. Fix: return a wrapper `<span>` as the root and swap only its child, or render the fallback without touching the DOM that CodeMirror owns. Confirm the mechanism before fixing.
- **Unresolved relative path.** The placeholder shows the raw `img/…` path, so `resolveAssetSrc` (`app/lib/asset-urls.ts`) returned it unchanged: `ctx.drive` or `ctx.driveToken` was missing when the widget was built. The browser then fetched `img/…` against the gmist origin and got a 404. Find out when the context is empty (a local sidecar file? before the Drive token arrives?) and either wait for it or skip the widget until it is available.

## Done when

A doc with a relative image whose load fails shows a fallback on screen and leaves the file on disk byte-for-byte unchanged.
