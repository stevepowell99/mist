# Author grammar (shared by gmist and the Causal Map Garden)

This is the canonical contract for the markdown author syntax that **two**
renderers turn into the same styled HTML:

- **gmist** (TypeScript): the `applyGrammar` pipeline in `app/lib/slides-build.ts`
  (`convertBignums`, then `convertCallouts`, `convertSpans`, `convertImages`,
  `convertDivs`, with code spans masked), the single entry shared by the slide
  builder, the document `Preview` and the library thumbnails so the three cannot
  drift.
- **the Garden** (Python): `build_static_site.py` in the `19aCMgarden` project, a
  static site generator over an Obsidian vault.

Two codebases in two languages will drift unless pinned to one written spec. This
doc is that spec. It covers the **syntax** and the cross-renderer contract. It
does **not** restate the CSS class catalogue, which has a single home (see below).

Background and the staged plan to converge the two are in
`plans/garden-shared-styles.md`.

## Single sources (do not duplicate these elsewhere)

| Thing | Canonical home |
|---|---|
| House framework CSS + class catalogue | `app/styles/deck-base.css` (+ `app/styles/classes.json` manifest) |
| gmist converters | `app/lib/slides-build.ts` |
| Garden renderer | `19aCMgarden/build_static_site.py` |
| Brand palette (the colours themselves) | hub `CLAUDE.md`, "Corporate colours for Causal Map" |
| Class-vocabulary map + migration plan | `plans/garden-shared-styles.md` |

## The shared grammar

| Construct | Syntax | gmist | Garden | Agree? |
|---|---|---|---|---|
| Callout | `> [!type] Title` + `> ` lines | becomes `::: {.callout .callout-type}` | `.callout.callout-type` (+ foldable `<details>`) | type set agreed (below); colour buckets differ slightly |
| Inline span | `[text]{.class}` | yes | yes | yes |
| Fenced div | `::: {.class}` ... `:::` | full (any classes, nesting) | partial (heading/section classes) | converge in Phase 3 |
| Image attrs | `![alt](src){.class width=…}` | yes | yes | yes |
| Citation | `[@key]` / bare `@key` + a `.bib` | inline APA + reference list | inline APA + reference list | yes |
| Math | `$…$`, `$$…$$` | yes | yes (MathJax) | yes |
| Mermaid | ` ```mermaid ` | yes | yes | yes |
| Columns | see below | `::: {.columns}` / `::: {.column}` | `--- start-multi-column` | intentionally different |

## Callouts

Both renderers accept the full Obsidian/Quartz callout vocabulary. gmist styles
five colour buckets in `deck-base.css`; the wider type set is normalised onto
those buckets in `convertCallouts` (`CALLOUT_ALIAS`). This is **parity of colour,
not identity**: a file written for the Garden renders with a sensible colour in
gmist rather than a bare grey fallback.

| Bucket (colour) | Types that resolve to it |
|---|---|
| note (blue) | `note`, `info`, `cite` |
| info aliases (blue) | `abstract`, `summary`, `tldr`, `todo`, `question`, `help`, `faq` |
| tip (green) | `tip`, `success`, `done`, `check`, `hint` |
| warning (yellow) | `warning`, `caution`, `attention` |
| danger (pink) | `important`, `danger`, `error`, `alert`, `failure`, `fail`, `missing`, `bug` |
| quote (grey) | `quote`, `example` |
| unknown | any other `[!x]` falls to the neutral base `.callout` (grey) |

Two deliberate divergences from the Garden's grouping, kept because gmist already
styles these distinctly and they are not breakage:

- `important` and `hint`: the Garden colours these green (its tip bucket). gmist
  keeps `important` pink (its danger bucket) and only maps `hint` to green.
- `example`: the Garden colours it as info (blue). gmist keeps it grey (its quote
  bucket).

**Foldable callouts** (`> [!type]+` / `> [!type]-`): the Garden renders a
collapsible `<details>`. gmist tolerates the `+`/`-` marker and renders a normal
callout with the content always visible (it has no `<details>` form yet).

## Fenced divs and spans

`[text]{.class}` spans and `::: {.class}` ... `:::` divs carry Pandoc attributes
(`.class`, `#id`, `style=`, `width=`). gmist handles arbitrary classes and nested
divs. The Garden handles spans and a partial set of div classes today; bringing
its div handling up to arbitrary classes is Phase 3 in the migration plan, and is
the step that lets gmist's composable component classes (`.panel`, `.cards`,
`.chip`, `.bignum`, the colour axis) be authored in Garden files once their CSS
ships (Phase 2).

## Columns

The two column syntaxes are intentionally different and both stay supported:

- gmist: `::: {.columns}` wrapping `::: {.column}` blocks (CSS flex).
- Garden: the Obsidian multi-column plugin's `--- start-multi-column` fences,
  emitted as Bootstrap `.row` / `.col-md-*`.

A document that needs to render well in both should prefer simple top-to-bottom
flow; columns will not round-trip between the two.

## Frontmatter settings (gmist decks and docs)

gmist reads a small set of YAML keys, top-level **or** nested under
`format: revealjs:` (both are matched). It replaced reveal.js's themes with its
own, so most other Quarto `format: revealjs:` keys are ignored.

| Key | Effect |
|---|---|
| `format:` | Makes the file a deck: `slides`, `slide` or `revealjs` (all equivalent), or the nested `format:\n  revealjs:`. Without it the file is a flowing document. Detected by `isSlideDeck` in `app/lib/slides-build.ts`. |
| `theme:` | gmist theme CSS: `causal-map` (default), `qualia`, `brutalist`, `editorial`. An unknown value (e.g. an old reveal theme like `serif`/`black`) falls back to causal-map. Themes are plain files in `app/styles/themes/*.css`, resolved in `app/lib/themes.ts`, injected after `deck-base.css` and before any `css:`. The same theme CSS drives the document Preview, so a doc reads like its deck. |
| `footer:` | A global footer line shown on every slide (bottom-left). |
| `slide-number:` | `true` (current/total) or a reveal format string like `c/t`. |
| `navigation-mode:` | The plain left-to-right default is recommended. `grid` makes it 2D (sections across, slides down) but is confusing, so it is discouraged; `vertical` also exists. |
| `css:` | A Drive stylesheet, layered after the theme so it overrides it. |
| `bibliography:` | A `.bib` for `@`-citations and the auto reference list. |

Ignored: `width`/`height` (the slide is fixed at 1280x720) and any other
reveal/Quarto key. `::: {.brand}` drops the theme's logo in the top-left corner,
Causal Map by default and the QualiaInterviews wordmark for the `qualia` theme; a
theme overrides `--brand-logo` (and `--brand-ar`) in `app/styles/themes/brand.css`.

## Colour tokens

Decision (Steve, 16 June 2026): **keep both token sets.** No forced merge. The
Garden's primary is a softer sage; gmist uses the documented corporate hexes.
Neither surface's colours change. Both sets are named here so the brand lives in
one view, but the canonical values stay in their source files (and the brand
itself in the hub `CLAUDE.md`).

| Role | gmist (`deck-base.css`) | Garden (`build_static_site.py`) |
|---|---|---|
| Brand green | `--cm-mint #00FFAF`, semantic green `#217a52` | `--cm-accent-primary #79bb93` |
| Teal | `--cm-blue #6DC4C8` | `--cm-accent-secondary #90c3c6` |
| Ink | `--ink #1a1a2e`, `--cm-dark #1F1F36` | `--cm-accent-ink #1f1f36` |
| Muted | `--muted #e8edf2` | `--cm-muted #6c757d` |
| Highlight yellow | `--cm-yellow #F7ED73` | `--cm-accent-highlight #f7ed73` |

## Renderer differences that are intended

- gmist has slide-only constructs with no Garden equivalent and no meaning in a
  flowing page: `.flare` animation, `.place` + `.top-`/`.left-` positioning,
  `.cascade-*`, deck chrome (`.title-page`, `.slide-breadcrumb`, `.shot-cap`).
- The Garden owns the whole site layer gmist lacks: sidebar, rightbar,
  breadcrumb, table of contents, search, backlinks, theme pages, PDF export, and
  the page-type styling (`.banner*`, `.rounded*`, `.paper-page`).
- On any class-name collision the Garden's version is canonical; gmist adapts.
