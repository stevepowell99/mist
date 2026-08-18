# Plan: live preview, a fourth View alongside Editor / Split / Preview

Status: BUILT, 13 August 2026. Steve asked for the Obsidian feel and nothing more: the markdown syntax recedes while you write, and the marks come back on the line you are working on. Everything listed under "Not in this version" stays out. What shipped, and what the build taught, is under "As built" at the end; the design below is what was followed.

## What this is

A fourth View button in the navbar, next to Editor, Split and Preview. In that View the editor still holds raw markdown, and CodeMirror hides the syntax marks the cursor is not near:

- `## Heading` shows as a heading with no `##`, until the cursor lands on that line.
- `**bold**` and `_italic_` show as bold and italic, with the asterisks and underscores back when the cursor sits inside the span.
- `` `code` `` and `~~struck~~` behave the same way.
- `[text](url)` shows as the link text, with the brackets and URL back under the cursor.

Everything else in the app carries on as it is.

## Why it is cheap here

The document model does not change, and neither does anything downstream of it.

- The CRDT is one `Y.Text` of raw markdown and save is `ytext.toString()`, an identity. Decorations paint over the text and never edit it, so sync, the conflict machinery, CriticMarkup and the comment threads all see the same bytes as before.
- Obsidian's Live Preview uses the same architecture, CodeMirror 6 plus decorations. There is nothing to port and no rich-text model to introduce, so the "do not reintroduce marks or a node model" rule in `CLAUDE.md` is untouched.
- `markdown()` from `@codemirror/lang-markdown` is already in the extension list, so `syntaxTree(state)` gives a parsed tree to decorate against. No regex scanning, and a `#` inside a fenced code block is a code line in the tree rather than a heading.
- Six decoration plugins already exist in `app/lib/` (`cm-criticmarkup`, `cm-markdown-style`, `cm-fenced-divs`, `cm-classes`, `cm-active-comment`, `cm-folding`), so the file layout, the visible-range build and the CSS conventions are settled ground.
- `cleanView` already hides CriticMarkup delimiters by toggling a class on the editor DOM. Live preview reuses that pattern for its typography.

## Part 1: the View toggle

`docs.$id.tsx` derives the View from two pieces of layout state (line 331):

```ts
const view: "editor" | "split" | "preview" = splitOpen ? "split" : showPreview ? "preview" : "editor";
```

Add a `livePreview` boolean and a fourth arm:

```ts
const view: "editor" | "live" | "split" | "preview" =
  splitOpen ? "split" : showPreview ? "preview" : livePreview ? "live" : "editor";
```

`setView` (line 335) gains a `"live"` branch that sets `showPreview` false, `editorPct` 100 and `livePreview` true; every other branch sets `livePreview` false. The four Views stay exclusive, which keeps the navbar, the keyboard and the URL speaking one language, as the comment there says.

Then follow the existing three-state wiring to its four call sites:

- **Navbar.** A fourth `ToolbarToggle` in the View pill (line 1056), with an `IconLive` defined beside `IconEditorOnly` and friends at line 127. Order it Editor, Live, Split, Preview. No `isDesktop` gate: unlike Split, this works on a phone.
- **Keyboard.** `runChord` binds `1`/`2`/`3` at line 662. Add `4` for live. Renumbering to put Live at `2` would read better and would also retrain three shortcuts Steve already has in his fingers, so it is his call (see the questions at the end).
- **URL.** The `?view=` mirror (around line 494) and the seed at line 305 both need `live`, so a reload keeps it.
- **Per-file settings.** Add `livePreview?: boolean` to `DocSettings` in `app/lib/doc-settings.ts`, restore it in the load effect (line 413) and include it in the debounced save (line 429). A new file then inherits the last View used, as the other settings do.
- **Help panel.** `HelpPanel.tsx` lists the shortcuts and needs the new line.

## Part 2: the CodeMirror layer

One new file, `app/lib/cm-live-preview.ts`, exporting an extension and one pure helper.

**Switching it on without a rebuild.** `CodeMirrorEditor.tsx` already carries a `Compartment` for the spellcheck language (`langCompRef`, lines 166 and 311). Add a `liveCompRef` the same way, holding either the extension or `[]`, reconfigured by an effect on a new `live` prop. Toggle a `live-preview` class on `view.dom` in the same effect that handles `clean-view` (line 304), because Part 3 hangs off that class.

**Building the decorations.** A `ViewPlugin` that walks `syntaxTree(view.state)` over `view.visibleRanges` and replaces mark nodes with nothing:

| Node | Hidden | Left showing |
|---|---|---|
| `HeaderMark` in an ATX heading | `#` run and the space after it | the heading text |
| `EmphasisMark` | `*` `_` `**` `__` | the emphasised text |
| `CodeMark` (inline) | the backticks | the code text |
| `StrikethroughMark` | `~~` | the struck text |
| `LinkMark`, `URL` | `[` `]` `(url)` | the link text |

Use `Decoration.replace({})` over each mark range. For a heading, extend the range one character to cover the space after the hashes, or the line starts with a stray indent.

**The reveal rule, which is the whole feel.** One helper decides whether a mark stays visible, given the current selection ranges:

- Block marks (the heading hashes) reveal when any selection range touches that **line**. This is why putting the cursor on a heading brings its `##` back.
- Inline marks reveal when any selection range overlaps the parent inline node, widened by one character each side so arrowing in from outside reveals before the cursor is swallowed.

The plugin therefore rebuilds on `docChanged || viewportChanged || selectionSet`, unlike the existing plugins, which ignore selection. The cost is one pass over the visible range per cursor move, which is what Obsidian pays too.

**Arrow keys must not step into hidden text.** Feed the same decoration set to `EditorView.atomicRanges` through the plugin's `provide`, so the cursor jumps a hidden `##` rather than sitting invisibly inside it. Without this the caret appears to stall, which is the main way a live-preview layer feels broken.

**Do not hide anything inside a CriticMarkup span.** Call `criticSpans` on the visible slice, as `cm-criticmarkup.ts` does, and skip any hide whose range intersects a span. Two reasons: inside `{++ ++}` the delimiters are the content under review, and two replace decorations over one range fight each other. If live preview still reads oddly while suggesting, the fallback is to force the View back to Editor whenever `mode === "suggest"`.

## Part 3: typography

`markdownLineStyle` already puts `cm-h1` to `cm-h6` classes on heading lines and states that font family and size are left alone on purpose. Live preview wants both, so scope the change to the new class rather than changing that plugin:

- In `app/app.css`, beside the `.clean-view` rules at line 324, add a `.live-preview` block: real sizes for `.cm-h1` to `.cm-h6`, a proportional family and a reading measure on `.cm-content`.
- Source view keeps its monospace look because none of this applies without the class.

## What this does not disturb

- **Scroll sync.** The offset-to-pixel anchor machinery runs between the editor and the Preview DOM, which only exist together in Split and Preview. Live is an editor-only View, so it never engages. Character offsets are unchanged anyway, because the document is unchanged.
- **Comments, threads and the selection toolbar.** All of them work in source offsets, which decorations do not move.
- **Decks.** No special handling. The deck workflow is Split with the slide preview, and that is still the right pairing; the Live button is simply there if someone wants it.
- **Save, conflict handling, Drive.** Nothing in this plan reaches them.

## Not in this version

Images inline, mermaid inline, tables as grids, callouts and `:::` fenced divs rendered, list bullets replaced, clickable checkboxes, LaTeX, `:icon:` glyphs, wikilink pills, hidden frontmatter. Tables in particular need a widget hosting a nested editor and should stay out until the rest earns its place.

## Build order

1. Toggle plumbing end to end with an empty extension: state, navbar, shortcut, URL, per-file settings, help. About an hour, and it proves the wiring before any decoration exists.
2. `cm-live-preview.ts` with headings only, plus `atomicRanges`. About two hours. Stop here and use it for a day; headings alone carry most of the feel.
3. Emphasis, inline code, strikethrough.
4. Links.
5. The `.live-preview` typography block.
6. Tests, `npm run typecheck`, `npm run deploy`.

## Tests

Export the reveal and hide logic as a pure function, `hideRanges(text, selectionRanges)`, so it tests without a DOM: parse with `markdown().language.parser.parse(text)` and assert the ranges. `tests/unit/lib/live-preview.test.ts`, covering a heading mark hidden with the cursor elsewhere and revealed with the cursor on the line, `**bold**` marks revealed only from inside, a mark inside a CriticMarkup span never hidden, and a `#` inside a fenced code block never treated as a heading.

## Three questions for Steve, and his answers

1. Exclusive fourth View, as planned here, or a flag that can combine with Split (live editor on the left, rendered preview on the right)? **Exclusive**, as planned.
2. `Ctrl/Cmd+Alt+4` for Live, or renumber so Live is `2` and Split and Preview shift to `3` and `4`? **`Ctrl/Cmd+Alt+4`**, so the three shortcuts he already has in his fingers stay put.
3. Keep Live available while suggesting, or drop back to the source View automatically in suggest mode? **Keep it**. CriticMarkup is never hidden, so a suggestion stays literal while the markdown around it recedes.

## As built

Files: `app/lib/cm-live-preview.ts` (new), `tests/unit/lib/live-preview.test.ts` (new), plus the wiring in `docs.$id.tsx`, `CodeMirrorEditor.tsx`, `doc-settings.ts`, `HelpPanel.tsx`, `cm-markdown-style.ts` and `app.css`. Verified in a browser against `npm run dev:local`: hide and reveal both directions, the URL round-trip, per-file persistence, and typing into a line whose marks are hidden landing where it looks like it will.

Four things the plan did not foresee.

- **Touching hidden ranges must merge into ONE range.** A link hides as four ranges in a row (`]`, `(`, the URL, `)`). Left separate, the caret can sit at a boundary BETWEEN two of them, which is invisible and puts typed text inside the URL: pressing End on a line ending in a link and typing wrote the character into the href. `atomicRanges` does not help, because each range is individually atomic and the boundary is outside all of them. `collect` now merges any contiguous run.
- **A view-wide class cannot be set with `view.dom.classList`.** CodeMirror rewrites that class attribute wholesale whenever its own attributes change, and taking focus is one such change, so clicking into the editor dropped the `live-preview` class and the typography reverted to source view while the marks stayed hidden. Both classes now go through `EditorView.editorAttributes` in a compartment. Clean view had carried the same fault unnoticed.
- **The editor had no syntax highlighting at all.** With the `**` hidden there was nothing left to carry the emphasis, so live preview also switches on a small `HighlightStyle` (strong, emphasis, strikethrough, inline code, link) inside its own compartment. Source view still has none, which is the point of it.
- **The parser was CommonMark, so `~~strikethrough~~` did not exist.** `markdown()` now takes `base: markdownLanguage` (GFM), which also gives tables a real tree.
- **`markdownLineStyle` styled a `#` inside a fenced code block as a heading.** Tolerable at one constant size in source view, glaring once live preview gives `.cm-h1` a real size, so that plugin now tracks fences and skips them. The live-preview layer never had the fault, because it reads the tree.

Still out, and now cheap to add if wanted: hiding the frontmatter block, list bullets as real bullets, and images. An image's `![alt](src)` markup is currently coloured like a link, because the markdown parser gives `Link` and `Image` the same highlight tag.

### Obsidian coverage, 18 August 2026

A sweep of Obsidian's own syntax against this layer, prompted by `---` not showing as a rule. Added: a thematic break (`---`, `***`, `___`) drawn as the rule, with the characters back when the cursor is on the line; `==highlight==`, which is Obsidian's and which no parser here knew, so it also went into the shared grammar (`convertHighlights` in `slides-build.ts`) and now renders as `<mark>` in the Preview pane and in a deck; and a task's `- [ ]` / `- [x]` as the one checkbox `marked` already renders in the Preview, the click falling through to the line so the source comes back.

CriticMarkup's own highlight is `{==...==}` and stays literal: the converter skips a `==` touching a brace, and everything inside a CriticMarkup span was already dropped from the hide set.

Deliberately still literal, in both this layer and the Preview pane, so the two agree: LaTeX (`$x$`, `$$x$$`), footnotes (`[^1]` and its definition, which this layer now claims so the parser does not hide the brackets and leave a bare `^1`), `%%comments%%`, `#tags`, block ids (`^abc123`) and definition lists. Each needs a renderer first; adding one to the editor alone would make the editor and the Preview disagree, which is the fault this layer is meant to avoid.

