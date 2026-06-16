# Plan: share gmist's style grammar with the Garden, without disrupting it

Status: Phases 0, 1 and 2 done (16 June 2026); Phase 3 (converge the two parsers'
corner cases) optional. The Garden changes are additive and built/verified
locally; they are NOT committed or deployed to the live Garden yet (Steve's call).
Every step is additive or documentation-only, and the Garden's existing look wins
on every collision.

## Background

Steve asked whether the Garden could drop Quarto and adopt gmist's new style
system. Two findings reframe that:

1. **The Garden does not use Quarto.** It is a bespoke ~8,000-line Python static
   site generator (`build_static_site.py`) over an Obsidian vault (~437 `.md`
   files), publishing to `dist/` on Netlify, with Bootstrap 5.3.3 from CDN. It
   only *copies in* pre-rendered Quarto `.html` if present. So "drop Quarto" is
   already done for the core.
2. **gmist is not a site builder.** Its style system is a CSS design grammar plus
   single-document markdown-to-HTML converters. It has no concept of multi-page
   nav, search index, backlinks, wikilink resolution, theme landing pages or PDF
   export, all of which the Garden does. Replacing the Garden's renderer with
   gmist would throw those away. Rejected.

What the two share is real, though: the **same Obsidian/Pandoc author grammar**
(`> [!type]` callouts, `::: {.class}` divs, `[text]{.class}` spans,
`![](){.class}` images, `[@key]` citations + a `.bib`) and the **same Causal Map
palette**. That overlap is the DRY target, not a merged renderer.

## Two design philosophies (why a single merged stylesheet is the wrong target)

| | gmist (`app/styles/deck-base.css`) | Garden (inline CSS in `build_static_site.py`) |
|---|---|---|
| Model | Composable: few components read global knobs, recoloured by orthogonal axes | Fully-baked: each variant is its own complete rule |
| Size | ~250 lines, one file, plus `classes.json` manifest | ~150 KB inline, generated in Python |
| Base | none | Bootstrap 5.3.3 (CDN) |
| Scope | `:is(.reveal,.preview)` | site-wide |
| Beyond styling | nothing | sidebar, rightbar, breadcrumb, TOC, search, backlinks, PDF |

A literal shared stylesheet would force Bootstrap and the composable model into
the same cascade, across two repos on different storage (gmist git vs the Garden
on Drive), and risk the Garden's HTML and PDF appearance. **Rejected.** The shared
work is a documented grammar, a token reference, and an opt-in component layer.

## Decisions taken

- **Colour: keep both token sets** (Steve, 16 June 2026). The Garden's primary is
  a softer sage `#79bb93` with teal `#90c3c6`; gmist uses the documented corporate
  hexes (mint `#00FFAF`, green `#217a52`, teal `#6DC4C8`). No forced merge. A
  single token *reference* names both sets in one place; neither surface's colours
  change.
- **On any class-name collision, the Garden wins.** gmist has no legacy; the
  Garden is live and PDF-proven. gmist adapts, never the Garden.
- **No merged renderer, no merged stylesheet.** Additive and documentation only.

## Class-vocabulary map (the side-by-side Steve asked for)

### Collisions: same name, both must keep working

| Concept | gmist | Garden | Verdict |
|---|---|---|---|
| Callout block | `.callout` + `.callout-note/-tip/-warning/-important/-caution/-quote` (composable aliases that set `--hue`) | `.callout` + `.callout-note/-info/-warning/-tip/-alert`, **plus** `-hero/-panel/-step/-card/-stat/-testimonial/-cta` and modifiers `-narrow/-right/-center/-heavy/-left-border/-rounded/-inverted/-foldable`; PDF-tuned | **Keep Garden's.** gmist must never emit its callout CSS into the Garden. Both are fed by `> [!type]`, so the *grammar* is shared even though the CSS is not. |

That is the only true collision. Everything below is non-colliding.

### Same intent, different name: alias, do not rename

| Concept | gmist | Garden |
|---|---|---|
| Inline highlight | `.hl` (static), `.flare` (animated) | `.mark` (from `==text==`) |
| Lead/intro text | `.lead` | `.kicker`, `.hero` |
| Reference list | `.references-slide` | `.references` / `.reference` |
| Image caption | `.caption`, `.shot-cap` | `.content.figcaption`, `.cm-img-*` |

### gmist-only: safe to ADD to the Garden as an opt-in layer (no name clash)

| gmist class | What it gives a Garden author |
|---|---|
| `.panel` | padded box with accent left border, recolourable |
| `.cards` / `.card` (plus `.cols-2/3/4`) | responsive card grid |
| `.chip` | inline pill (Garden uses Bootstrap `.badge` today) |
| `.bignum` | headline figure beside a note |
| Free colour axis `.blue .cyan .teal .green .mint .yellow .pink .mag .navy .grey .white .black` | recolour any component inline; the Garden has **no** free colour classes today (colour is baked into `.banner-info` etc.) |
| `.scale-25…500`, `.left/.center/.right` | zoom and align utilities |

These depend on gmist's `--hue*` variable layer to be useful, so the layer ships
as a unit (variables plus components plus colour axis), namespaced so it cannot
reach existing Garden rules.

### gmist-only: NOT worth porting

`.place` + `.top-/left-` coordinates, `.flare` animation, `.cascade-*`, deck
chrome (`.title-page`, `.slide-breadcrumb`, `.shot-cap`): slide-only, no meaning
in a flowing document.

### Garden-only: out of scope for gmist

Site chrome (`.sidebar`, `.rightbar`, `.breadcrumb-nav`, `.toc`, search, nav),
page-type styling (`.paper-page`, `.banner*`, `.rounded*`), Bootstrap grid
columns (`.row`, `.col-md-*`), `layout: fullscreen`. gmist has no equivalent and
needs none.

### Token vocabularies (both kept; named in one reference)

| Role | gmist | Garden |
|---|---|---|
| Brand green | `--cm-mint #00FFAF`, semantic green `#217a52` | `--cm-accent-primary #79bb93` |
| Teal | `--cm-blue #6DC4C8` | `--cm-accent-secondary #90c3c6` |
| Ink | `--ink #1a1a2e`, `--cm-dark #1F1F36` | `--cm-accent-ink #1f1f36` |
| Muted | `--muted #e8edf2` | `--cm-muted #6c757d` |
| Highlight yellow | `--cm-yellow #F7ED73` | `--cm-accent-highlight #f7ed73` |

Same intent, different names and (for green/teal/muted) different values. The
reference doc lists both sets so the brand lives in one place even unmerged.

## The grammar both parsers implement (already, independently)

| Author syntax | gmist (`app/lib/slides-build.ts`) | Garden (`build_static_site.py`) |
|---|---|---|
| `> [!type]` callout | becomes `::: {.callout .callout-type}` | becomes `.callout.callout-type` (plus foldable `<details>`) |
| `::: {.class}` fenced div | yes | partial (heading/section classes) |
| `[text]{.class}` span | yes | yes |
| `![](){.class}` image | yes | yes |
| `[@key]` + `.bib` to APA + ref list | yes | yes |
| Mermaid, math | yes | yes |
| Columns | `::: {.columns}` / `::: {.column}` (flex) | `--- start-multi-column` to Bootstrap `.row`/`.col-md-*` |
| Custom callout fence | none | `--{.type-modifier}` |

The two parsers will drift unless pinned to one written spec. That spec is the
cheapest, highest-value shared artifact.

## Plan (staged, each step independently shippable, none disrupts the Garden)

### Phase 0: spec only, no code. DONE 16 June 2026.
- `docs/author-grammar.md` written: the canonical cross-renderer grammar contract
  (callouts, divs, spans, image attrs, citations, columns), marking where the two
  legitimately differ and where they must agree. It points to `deck-base.css` /
  `classes.json` for the class catalogue rather than restating it.
- The token reference is folded into that same doc as a "Colour tokens" section
  (both sets named, pointing to the hub `CLAUDE.md` brand source), not a parallel
  file. Location decided: gmist `docs/`, co-located with the grammar spec and the
  styling work; can move to the hub later if a more neutral home is wanted.

### Phase 1: gmist adopts the Garden's callout vocabulary at the grammar level. DONE 16 June 2026.
- `convertCallouts` in `app/lib/slides-build.ts` gained a `CALLOUT_ALIAS` map that
  normalises the wider Obsidian type set (`summary`, `faq`, `done`, `attention`,
  `failure`, `cite`, and so on) onto gmist's five styled colour buckets. A
  Garden-authored file now renders with a sensible colour instead of a bare grey
  fallback. One change covers both surfaces, since the doc `Preview` reuses the
  same converter. Two deliberate colour divergences (`important`, `example`) are
  documented in the grammar doc. Typechecks clean.
- gmist-only, additive. No Garden change.

### Phase 2: additive composable layer for the Garden. DONE 16 June 2026 (built and verified locally, not yet live).
What shipped into the Garden working tree (`19aCMgarden`):
- **`garden-compose.css`** (new file): a curated port of gmist's CORE axes
  (colour, shade, align, scale) and components (`.hl`/`.flare`, `.panel`, `.bg`,
  `.chip`, `.cards`/`.card`, `.columns`/`.column`, `.bignum`), scoped to
  `.content`. Deliberate adaptations: `.callout*` dropped (Garden owns them),
  `.lead` dropped (Bootstrap owns it), `.card` scoped under `.cards` so Bootstrap's
  `.card` is never clobbered, colour values kept as gmist's hexes. It is loaded
  once in `build_static_site.py` and injected as a `<style>` AFTER the site CSS,
  so it can only add classes. Delete the file to switch the layer off.
- **Two parser additions in `build_static_site.py`** (the gap the plan had folded
  into Phase 3): the Garden supported neither gmist construct.
  - `preprocess_fenced_divs`: `::: {.class}` to nestable `<div class=".." markdown="1">`
    (md_in_html parses inner markdown and nests), for block components.
  - `preprocess_inline_spans`: `[text]{.class}` to `<span>` (Python-Markdown's
    attr_list does not build spans from bare brackets). Links/images use
    `](url){..}` so they are not matched.
  Both fire only on syntax the Garden never used, so existing pages are untouched.
- **Three grammar bug-fixes** found by building a test page, applied to BOTH
  `garden-compose.css` and the gmist source `deck-base.css` (kept aligned):
  nested-shade `--fill` bleed (a coloured component in a shaded parent now fills
  with its own hue), dark-panel lead colour (flips to light text), and `.bignum`
  text (pins dark so a bignum in a dark card stays readable).
- Verified by rendering one test page (`content/!compose-test.md`, the `!` keeps
  it out of nav and commits) through the real pipeline to HTML, a print-emulated
  screenshot and a PDF, iterating until both were correct. Scratch runner and
  output are `_compose_runner.py` and `_compose_out/` (underscore-prefixed, never
  built or committed).

Remaining for Steve: decide whether to commit `build_static_site.py` +
`garden-compose.css` in the Garden and let it deploy (the layer is additive and
inert on existing pages, so going live changes nothing visible). The original
plan's idea of a config flag was not needed: deleting the CSS file is the off
switch, and a full rebuild already regenerated `dist/` with the inert layer.

### Phase 3 (optional, later): converge the converters toward the spec
- Bring gmist's `::: {.class}` div handling and the Garden's to the same corner
  cases, per `docs/author-grammar.md`. Keep two implementations (TS and Python);
  do not attempt to share code across the language boundary. The spec is the
  shared thing, not the code.

## What we explicitly will NOT do
- Merge the two stylesheets into one file.
- Push gmist's callout, colour-value, or chrome CSS into the Garden.
- Replace the Garden's Python renderer with gmist.
- Change the Garden's palette or any existing Garden class.
- Share parser code across the TS and Python boundary.

## Open questions
- Where does the canonical token reference live: gmist `docs/`, or the hub? (Hub
  is more neutral since both projects are spokes.)
- Phase 2 mechanism: does the Garden's Python read `garden-compose.css` from a
  synced path, or is the file mirrored into the Garden repo with a "generated, do
  not edit" header? Cross-repo sync versus a mirrored copy.
- Is Phase 2 even wanted? It is the only step touching the Garden, and the Garden
  already styles well. The grammar spec (Phase 0) and gmist's callout parity
  (Phase 1) may be the whole worthwhile win.
