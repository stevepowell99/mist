# Plan: the plain Y.Text document core (#13) and safe live save

Status: design, 15 June 2026. Implements build-order step 1 of [`live-collab.md`](live-collab.md) in full. No code until this is agreed. This is the foundational fidelity fix: it is the prerequisite for safe live save (#33), the cloud-bridge diff-merge (#9), showing YAML in the editor (#29), and line-accurate scroll sync.

## Why this, why now

Steve wants live save back: edits flushing to the Drive source file on a timer, not only on an explicit press. Today that is unsafe, and the reason is structural.

The CRDT is a TipTap/ProseMirror document of `Document` then `Paragraph` then `Text` (`app/components/Editor.tsx:261`). Each line of markdown is one `paragraph` node; CriticMarkup is carried as **marks** on the text (`criticAddition`, `criticDeletion`, `criticComment`, `criticHighlight` in `app/lib/critic-marks.ts`); markdown syntax (`#`, `:::`, `**`) is literal text, decorated for display.

Saving walks the paragraphs and joins them with a single `\n` (`app/lib/critic-serializer.ts:40`). So a true markdown paragraph break (`\n\n`) and a soft line break (`\n`) collapse to the same thing on the way out. An *unedited* file round-trips byte-for-byte (the serializer is only invoked with threads, and frontmatter is kept verbatim), but *edited* prose loses its blank-line structure. This is the "body soft/hard break fidelity" gap already documented as inherent to the XmlFragment core.

Explicit-save-only is tolerable because Steve saves rarely and avoids heavily-edited files. **Live save inverts that**: it writes continuously, so every edited paragraph pushes a subtly mangled file to Drive on a timer. You cannot make live save safe on top of a lossy serializer. The serializer has to become an identity first. That is what this plan does.

## The target: text is the source of truth

Replace the ProseMirror document with a single `Y.Text` holding the raw markdown **verbatim**, CriticMarkup inline as literal delimiters:

- `{++inserted++}` suggestion to add
- `{--deleted--}` suggestion to remove
- `{~~old~>new~~}` suggestion to replace
- `{==highlight==}` highlight
- `{>>comment<<}` comment

Save-back then becomes `ytext.toString()` to file bytes: an identity. Nothing to reconstruct, no paragraph join, no YAML round-trip through the editor, byte-identical every time including for heavily-edited prose. The same plain-text core serves both backends (each just persists markdown), which is why `live-collab.md` chose it.

### Consequence: the editor library changes

`Y.Text` cannot back ProseMirror; `y-prosemirror` binds only to a `Y.XmlFragment`. A collaborative markdown **source** document is CodeMirror 6 territory:

- **CodeMirror 6 plus `y-codemirror.next`** for the editor and the Yjs binding. The binding gives collaborative cursors and selections out of the box (replaces `CollaborationCaret`), and CM6 is the natural home for syntax decorations and keymaps.
- The current `app/lib/markdown-decorations.ts` (Quarto control codes, headings, images) and `app/lib/markdown-shortcuts.ts` (Mod+B/I wrap, `==` highlight, wrap-on-selection) re-expressed as CM6 extensions. CM6 decorations and `keymap` are a closer fit than the TipTap plugins they replace.

This is a real editor swap, not a tweak. It is the bulk of the work and the main risk, so the rollout below proves it in isolation before anything user-facing changes.

## The three hard parts

### 1. CriticMarkup rendering (the fiddly one)

Today CriticMarkup is marks; in the new core it is literal delimiter text. The editor must still *look* like mist: the delimiters hidden or dimmed, inserted text green, deleted text struck red, comments and highlights tinted, with a clean-view mode that hides suggestions entirely.

In CM6 this is a `ViewPlugin` that scans the visible text for the five delimiter pairs and emits decorations:
- `Decoration.replace` over the opening/closing delimiters to hide them (or `mark` to dim them), the same visual the current `CriticDelimiters` extension produces.
- `Decoration.mark` over the inner content for the colour (addition/deletion/comment/highlight classes, reuse the existing CSS).
- Clean view drops the suggestion decorations and instead `replace`s deletions with nothing and additions' delimiters with nothing, so the accepted text shows.

Accept/reject a suggestion becomes a text edit (delete the `{--...--}` span, or unwrap `{++...++}` to its content) rather than a mark removal. Simpler and exactly faithful, because the document already is the text.

The CriticMarkup parser (`app/lib/critic-parser.ts`) and the delimiter constants (`app/lib/critic-constants.ts`) are reused as-is for scanning; `app/lib/critic-serializer.ts` (marks to text) is **deleted**, since there is nothing to serialize when the text is already markdown.

### 2. Comment / suggestion anchoring

Today a comment is a `criticComment` mark carrying a `threadId` attr (`app/lib/critic-marks.ts:55`), and the thread metadata (author, replies, resolved, timestamps) lives in a Yjs `threads` map keyed by that id (`agents/document.ts:401`), folded into the `mist:` frontmatter key on save (`app/lib/thread-serialization.ts:109`). The mark is what binds a thread to a span of text and survives concurrent edits.

With text as the core there is no mark to carry the id. Two options:

- **(a) Encode the id in the delimiter.** Write `{>>threadId: comment text<<}` so the binding lives in the text itself, survives save/reload, and is visible to Obsidian. Drawback: it changes the on-disk CriticMarkup and bloats the comment text; non-mist tools show the id.
- **(b) `Y.RelativePosition` anchors in a side map (recommended).** Keep the `threads` map; add, per thread, a pair of `Y.RelativePosition` (start, end) stored as part of the thread entry. Relative positions are Yjs's purpose-built mechanism for surviving concurrent inserts and deletes. The comment delimiters in the text stay anonymous `{>>...<<}` (clean for Obsidian); the anchor is the relative-position pair. On save we still fold thread metadata into `mist:` frontmatter as now, and on load we re-derive anchors by scanning for the comment spans in document order and pairing them to threads (the current import already matches by `highlight` text; keep that as the load-time bind, then track live by relative position).

Recommend (b): it keeps the on-disk markdown clean and uses the right Yjs primitive. (a) is the fallback if relative-position bookkeeping proves fragile.

This is the part most likely to need iteration, so the rollout lands it after the core round-trip is proven, with its own tests.

### 3. The editor swap itself

Everything wired into the TipTap `useEditor` (`app/components/Editor.tsx:257`) has a new home: the citation `@`-picker (`CitationSuggest`), the comment click handler and highlight decorations, suggest-mode gating, image resolution. Each is a CM6 extension or a small adapter. The `Editor.tsx` public props (`onEditorReady`, `commentHighlight`, `activeCommentRange`, `cleanView`, callbacks) stay the same shape so `docs.$id.tsx`, the outline panel, and the thread panel keep working against a stable interface. The outline (`app/lib/outline.ts`) already reads heading text by scanning line content, so it ports to "scan the CM6 doc lines" with little change.

## Layer B: safe live save (the write loop)

Once the serializer is an identity, live save is a bounded addition (this is cloud-bridge #9, the half that writes):

- **Debounced flush.** On a few seconds of edit-idle, the relay serialises `ytext.toString()` (plus `mist:` threads) and writes to Drive. Reuse the existing `commitNow` path; remove the explicit-only restriction.
- **Conditional write.** Every write carries the expected Drive `etag` (the `version` in the `DocBackend` interface). On a 412 (the file changed underneath, for example someone saved in Obsidian) do **not** clobber: re-read the file and diff-merge into the `Y.Text` with diff-match-patch as positioned inserts and deletes, then let the next flush write the merged result.
- **Normalise before diffing.** Strip CRLF and trailing-whitespace differences so an editor's line-ending setting does not read as a real edit.
- **Unsaved/saved indicator (#33).** With live save on, the "unsaved edits look live but are not in the file" illusion goes away for the common case. Keep a visible saved/saving/error state so a failed write is unmistakable, and keep warn-on-leave for the in-flight window.

Layer B is largely independent of the editor swap, but it is only trustworthy on top of Layer A. Build A, prove fidelity, then add B.

## Rollout (de-risked, app stays working throughout)

The live app keeps the TipTap core until the new one is proven. Build the new core as a parallel path:

1. **Spike: CM6 plus Y.Text round-trip.** A standalone CodeMirror 6 editor bound to a `Y.Text`, seeded from a markdown file, with the relay seeding `getText("body")` instead of `getXmlFragment("default")`. Prove the headline claim: open a real edited Drive file, change prose and add a suggestion, save, and diff the bytes; an unedited save is byte-identical and an edited save preserves paragraph breaks. No comments, no `@`-picker yet. This is the day-one go/no-go.
2. **CriticMarkup decorations plus suggest mode** in CM6 (hard part 1): rendering, clean view, accept/reject as text edits, Mod+B/I and `==` shortcuts. Unit-test the decoration ranges and the accept/reject text transforms.
3. **Comments** (hard part 2): relative-position anchors, the click handler, the thread panel binding, load-time re-anchor. Unit-test anchor survival across concurrent edits.
4. **Citations, images, outline, decorations** ported; `Editor.tsx` swapped to the CM6 component behind its existing props. Playwright-verify decks, document preview, citations, comments against the live app.
5. **Flip the default and delete the ProseMirror stack** (TipTap extensions, `critic-marks.ts`, `critic-serializer.ts`, the XmlFragment seed branch). One backend, one core.
6. **Layer B: live save** (debounced conditional write plus diff-merge), then re-enable it as the default with the saved-state indicator.

Each step is web-testable in the same Playwright loop (`C:\tmp\mist-verify`) that built the current app.

## Progress

**Step 1 (CM6 + Y.Text round-trip spike): GO, 15 June 2026.** Proven on the dev server with Playwright. The relay now also seeds the raw body into `getText("body")` (additive, alongside the XmlFragment seed, so both cores coexist during the migration, `agents/document.ts`). A throwaway `/spike/:id` route binds CodeMirror 6 to that `Y.Text` via `y-codemirror.next` (`app/components/CodeMirrorEditor.tsx`, `app/routes/spike.$id.tsx`; not linked from the app). Results on a doc with multi-line `css:` frontmatter and mixed paragraph/soft breaks:
- Seeded round-trip `serializeThreads(ytext.toString(), [], frontmatter)` equals the source **byte-for-byte**.
- An edit lands verbatim; consecutive newlines (a blank-line paragraph break) survive, the exact case the XmlFragment paragraph-join collapsed.
- Two clients sync over the existing provider, and `y-codemirror.next` remote cursors render.
- The multi-line `css:` YAML list round-trips untouched (it stays in the Yjs `meta` map, never through the editor).

Known dev-only artifact: the first open of a brand-new room sometimes fails to sync/hydrate (workerd DO cold start plus vite on-demand chunk compile); it resolves on retry and does not occur on the deployed worker. The same provider backs TipTap, so this is not CM-specific.

**Step 2 (CriticMarkup decorations + suggest mode): done, 15 June 2026.** Deployed and verified (dev unit tests + Playwright on dev and remote).
- `app/lib/cm-criticmarkup.ts`: a shared span parser (`criticSpans`) and a `ViewPlugin` that decorates the five CriticMarkup types in the visible document, reusing the existing classes (`cm-addition`, `cm-deletion`, `cm-comment`, `cm-highlight`, `cm-delimiter`), so editor, clean-view and dark-mode CSS carry over. Substitutions render old as deletion, new as addition.
- `app/lib/cm-suggest.ts`: the pure `suggestEdit` (typing wraps `{++…++}`, deleting wraps `{--…--}`, replace strikes-and-adds, adjacent same-type runs merge, typing inside an addition extends it, deleting the last char drops the wrapper) plus a `transactionFilter` that rewrites only this user's typing/deleting/pasting; remote (collab) and programmatic changes pass through untouched. 15 unit tests.
- `app/lib/cm-shortcuts.ts`: Mod-B/I wrap and type-a-wrapper-over-a-selection (`*_=\`"'([{`), as "input.wrap" so suggest mode leaves them as plain formatting.
- Clean view toggles a `clean-view` class on the editor, reusing the existing CSS to hide delimiters.
- The spike route gained mode and clean-view toggles for testing. All 395 unit tests pass.

Verified visually: seeded CriticMarkup renders exactly like the TipTap editor (green additions, struck-red deletions, highlight/comment underlines, dimmed delimiters); suggest-typing yields `{++…++}`, backspace yields `{--…--}`, and the save bytes stay verbatim.

Next: step 3, comments (relative-position anchors, click handler, thread panel binding).

**Step 3 (comments): done, 15 June 2026. Anchoring turned out simpler than planned.** Because a comment is literal `{>>...<<}` / `{==...==}` text in the Y.Text, the CRDT moves it through concurrent edits on its own, so NO `Y.RelativePosition` side map is needed: we just re-scan. The thread metadata model is unchanged (the Yjs `threads` map folded into `mist:` frontmatter), and the existing `matchThreadsToComments` is reused as-is.
- `app/lib/cm-comments.ts`: `scanTextComments` (point and highlight-paired comments, offsets are CM positions), `insertCommentChange` (wrap a selection as `{==sel==}{>>note<<}`, or insert a point `{>>note<<}`), `removeCommentChange` (drop the comment, unwrap the highlight on resolve/delete), `activeRangeFor`. 10 unit tests, including the concurrent-edit survival property.
- `app/lib/useTextThreads.ts`: the CM6 analogue of `useThreads` (reconcile by scanning text, auto-create thread metadata, reply/resolve/delete, jump-to, active range), reusing `matchThreadsToComments`.
- `app/lib/cm-active-comment.ts`: a `StateField` + effect that tints the active comment with `cm-comment-active`, mapped through edits.
- `CodeMirrorEditor` exposes its view (`onViewReady`) and takes an `activeComment` range; the spike route gained a working comment panel (create, list, reply, resolve, delete, click-to-jump).

Verified on dev and remote: create a range comment from a selection -> `{==brown==}{>>note<<}` in the text and `highlight: brown` folded into `mist:` frontmatter; panel binding, jump tint, reply, and resolve-removes-markup all work. 405 unit tests pass.

This clears both genuinely hard parts (suggest mode, comment anchoring).

**`@`-citation picker on the CM6 core: done, 15 June 2026.** `app/lib/cm-citations.ts` is a CodeMirror autocomplete source over the same `BibLibrary` shape: typing `@` lists the document's entries (author, year, title), filtered live, and inserts Pandoc `[@key]`, matching the TipTap picker. `CodeMirrorEditor` takes a `bibLibrary` prop (read live via a ref); the spike feeds a static demo library. Verified on dev and remote: the popup opens, filters, and inserts `[@smith2020]`/`[@jones2019]`.

**Editor feature parity reached.** The CM6 / Y.Text editor now matches the TipTap editor's editor-integral features: markdown-source editing with control-code decorations, suggest mode, comments (create/reply/resolve/delete/jump/tint), clean view, Mod-B/I and wrap-on-selection, the `@`-citation picker, collaborative cursors and byte-faithful save. So **step 4 is now a pure wiring job**, not new behaviour. (Deferred refinement: a citation inserted in suggest mode currently goes in plain rather than wrapped as `{++[@key]++}`; minor, note it.)

## Steps 4-5: CM6 is the only editor (DONE, 15 June 2026)

Steve chose a clean replacement over an opt-in flag ("no-one using it yet"), so steps 4 and 5 landed together: the live `/docs` page renders the CodeMirror 6 / Y.Text editor and the entire TipTap stack is deleted. `DocumentContext` keeps its value shape (so `ThreadList`, `SaveStatus`, `CleanViewToggle`, `MobilePanel`, `OnboardingBanner` are untouched) but its internals are CM6: `markdown` is `ytext.toString()`, threads come from `useTextThreads`, comments and suggestions are text edits. `SuggestionActions`, `CommentInput` and `OutlinePanel` were reworked onto the view; `BubbleToolbar` was dropped (its actions are the aside's Accept/Reject and the "New comment" button). New pure logic: `cm-suggestion-actions.ts` (accept/reject at cursor and all) and `extractOutlineFromText`, both unit-tested.

Deleted: `Editor`, `BubbleToolbar`, `CitationPopup`, `critic-marks`, `critic-serializer`, `critic-parser`, `critic-constants`, `critic-markup`, `suggest-mode`, `markdown-shortcuts`, `markdown-decorations`, `citation-suggest`, `useThreads`, `suggestion-actions`, the `/spike` harness, and all their tests; the `@tiptap/*`, `y-tiptap` and `critic-markup` deps; the relay's XmlFragment seed. `comment-threads` keeps only its pure matching helpers. No `@tiptap` imports remain.

Verified on remote `/docs`: editor loads, CriticMarkup renders, suggest typing wraps `{++..++}`, comment create yields `{==sel==}{>>note<<}` and shows in the aside, Accept all clears suggestions and keeps comments, navbar pills / preview / slides all work, no console errors. 247 unit tests pass; typecheck and production build clean.

## Step 6: live save (DONE, 15 June 2026)

With save now a faithful identity, auto-save is safe. The client flushes on a 2.5s edit-idle debounce (`AUTOSAVE_DEBOUNCE_MS` in `DocumentContext`, reusing the `commitNow` socket path). The relay writes conditionally on the file's `headRevisionId` (captured at import in `drive.import.ts`, stored as `driveVersion`, updated after each successful write), so an edit made in Obsidian/Drive while a session is open is never clobbered: on a version mismatch `DriveBackend.write` throws, the relay broadcasts `{type:"conflict"}`, the client sets a `conflict` flag that gates (pauses) auto-save, and `SaveStatus` shows an honest amber "Conflict" badge. Otherwise `SaveStatus` shows "Saving…/Saved". The `beforeunload` guard covers the in-flight window.

This largely resolves #33: edits reach the Drive file within seconds with a visible saved state, instead of looking live but unsaved. Conflict **reconciliation** (auto-merge of mist's edits with the upstream change) is the cloud bridge (#9) and is deliberately not built; the no-clobber floor is in place.

**The #13 migration is complete (steps 1-6).** Remaining related work is #9 (diff-merge on conflict / external-change sync) and #12 (idle auto-close), both separate tasks.

Verification note: end-to-end auto-save to an actual Drive file needs Steve's Drive auth (the `/new` demo docs are not backend-bound, so their save is a no-op and `SaveStatus` is hidden). The editor, the no-op-on-unbacked path, and the absence of console errors are verified on remote.

### Original step-4 approach (superseded by the clean replacement above)

1. **Opt-in flag.** Gate on `?core=ytext` (default stays TipTap). Render either `<Editor>` (TipTap) or a new `<CodeMirrorDocEditor>` wrapper in the editor pane; share the navbar, preview, slides, save bar and comment panel.
2. **Decouple the shared parts from the TipTap instance.** Today `DocumentContext` holds a `TiptapEditor`, derives `markdown` via `serializeWithCriticMarkup(editor.state.doc)`, and runs `useThreads(editor)`. For the CM6 path: `markdown` is just `ytext.toString()`; threads come from `useTextThreads`; the outline reads the text (port `extractOutline` to a text scan). Introduce a small editor-agnostic surface (current text, selection, a `jumpTo`, the thread API) so the page binds to that, not to TipTap directly.
3. **Save path.** Unchanged in shape: `serializeThreads(ytext.toString(), threads, frontmatter)` over the existing socket `commitNow`. The unsaved indicator and `beforeunload` guard already key off the serialized hash, so they carry over.
4. **Citations/images.** Pass the document's loaded `BibLibrary` (already fetched via `/drive/bib`) into `CodeMirrorEditor`'s `bibLibrary` prop. Inline image rendering in the source editor is a later nicety (Preview already renders images).
5. **Flip and delete (step 5, Steve signs off).** Make CM6 the default, then delete the TipTap stack (`Editor.tsx` extensions, `critic-marks.ts`, `critic-serializer.ts`, `suggest-mode.ts`, `markdown-shortcuts.ts`, `markdown-decorations.ts`, `citation-suggest.ts`, `useThreads.ts`, the XmlFragment seed branch, `CollaborationCaret`).
6. **Live save (step 6, the original goal).** With save now an identity, add the debounced conditional write + etag merge-guard and turn on auto-save with the saved-state indicator. This is the thing that needed the faithful core.

## What is reused vs deleted

Reused: the relay and SQLite persistence, the CriticMarkup parser and delimiter constants, the `threads` map and `mist:`-frontmatter thread serialization, the verbatim-frontmatter handling (`thread-serialization.ts`, now even simpler because the body never touches frontmatter), the Drive backend read/write, the citation library and `@`-picker logic (rehosted), the outline scanner, the deploy.

Deleted once step 5 lands: `app/lib/critic-serializer.ts` (no marks to serialize), `app/lib/critic-marks.ts` (marks become CM6 decorations), the TipTap extension set and `useEditor` in `Editor.tsx`, the per-line XmlFragment seed branch in `agents/document.ts:379`, `CollaborationCaret` (replaced by `y-codemirror.next` cursors).

## Risks and mitigations

- **CriticMarkup decorations in CM6 are the fiddliest piece.** Mitigation: step 2 is isolated and unit-tested before comments or citations sit on top.
- **Comment anchoring across concurrent edits.** Mitigation: use `Y.RelativePosition` (the right primitive), test anchor survival; fall back to id-in-delimiter if needed.
- **A second editor library's bundle and learning cost.** Accepted: CM6 is the standard collaborative-markdown stack and it removes the ProseMirror plus TipTap plus y-prosemirror layer, likely a net simplification.
- **Frontmatter must still never pass through the editor.** It does not: it stays in the Yjs `meta` map (`agents/document.ts:363`); the `Y.Text` is body only, exactly as the body is today. #29 (showing YAML) is a *separate, later* choice on top of this and is not in scope here.
- **Existing rooms hold XmlFragment state.** Migration: the new core seeds `getText("body")`; a room created under the old core has no `body` text. Re-seed on first open under the new core from the Drive source (the backend is the source of truth), or gate the new core to newly-opened rooms. Decide at step 1.

## Open decisions for Steve

- **Comment anchoring:** relative-position side map (recommended, clean on disk) vs id-in-delimiter (simpler, visible to Obsidian). Default to the former unless it proves fragile in step 3.
- **Live-save cadence:** debounce window (propose 3 to 5 seconds idle) and whether to also flush on blur or navigation.
- **Old-room migration:** re-seed from Drive on first open under the new core (recommended) vs leave old rooms on the old core until they expire.
