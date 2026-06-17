# Dimensional class system: unify, and make the CSS framework portable

Status: plan (updated 16 June 2026). Supersedes the earlier "keep the CSS in
the 19c-slides repo" stance, which assumed a dedicated styled parent folder. We
now want decks and docs to live anywhere in the filesystem, and 19c-slides is
being retired to ordinary content, so the framework moves into gmist.

The styling is one clean grammar. Two things were wrong: its catalogue (the list
of what exists) was hardcoded in several places that drift from the real CSS, and
the framework itself lived next to the decks, so a deck elsewhere had no styling.
This plan keeps a single editable CSS file as the source of truth for both
appearance and existence, ships it as the app default so any doc anywhere renders
correctly with no sibling files, and lets a doc layer its own CSS on top.

## Where styles (and the .bib) resolve: two layers, explicit only

The same model serves styles and references:

1. **App-level default.** gmist ships the house framework as an editable CSS
   file and applies it to every doc as the implicit first stylesheet. So a deck
   in any Drive folder gets full Causal Map styling with zero sibling files. The
   same for citations: one configured house library (`My Library.bib`-style) is
   the default bibliography.
2. **Per-doc / per-folder override, resolved relative to the doc.** Frontmatter
   `css: theme.css` and `bibliography: refs.bib` are resolved relative to the
   document, walking *up* parent folders (`driveResolvePath`, already built). A
   folder of decks shares one `theme.css` sibling or parent; a single deck
   overrides on its own.
3. **Nothing implicit in between.** gmist applies the app default, then only the
   files the frontmatter names. No scanning for a stray `_shared` up the tree.
   Predictable, and independent of any fixed folder by construction.

Principle for both: app-level house default plus a doc-declared override resolved
relative to the doc; no dependence on a special parent folder.

## The framework: an editable file, never hardcoded

- The framework is a plain CSS file in the gmist repo (`app/styles/deck-base.css`),
  served as a static asset and applied as the default. It is edited as CSS, not
  embedded as a TypeScript string, so maintenance is "open the stylesheet".
- The `.` picker derives the catalogue of existing classes from this CSS at
  runtime (`parseCssClasses`), so the picker never drifts.
- Per-deck CSS, when present, is layered after it and can override or extend.
- The only list gmist keeps in code is the genuinely-external reveal/Quarto set
  that is not in any CSS (`BUILTIN_CLASSES` in `cm-classes.ts`): `.fragment` and
  its effects, `.columns`/`.column`, `.r-fit-text`, callouts.

## The grammar: orthogonal axes, variable-driven, composition over naming

Every styled element is a composition of orthogonal axes. The core is a set of
CSS custom properties (the global knobs); components only read them, and the
colour/scale/shade/timing classes only set them. That is what makes the system
multidimensional and what makes aliases possible.

- **Knobs (custom properties):** colour (`--hue`, `--hue-bright`, `--hue-pale`,
  `--hue-deep`, `--on`), fill override (`--fill`), border override (`--border`),
  size (`--scale`), timing (`--dur`, `--delay`, `--ease`), position (`--x`, `--y`).
- **Component** (reads knobs, shows something): `.flare`/`.hl`, `.panel`, `.bg`,
  `.chip`, `.card`/`.cards`, `.bignum`, `.callout`.
- **Colour** (the text/accent hue; sets the knobs, shows text + a matching pale
  tint to a box on the same element): `.blue .cyan .teal .green .mint .yellow
  .pink .mag .navy .grey .white .black`.
- **Fill** `.bg-<colour>` sets only the background (pale, or solid with `.solid`);
  **Border** `.border-<colour>` draws a border in that colour (a panel keeps its
  left accent and a shape its outline, both reading the `--border` slot). So text,
  fill and border are three independent targets on one element. The 13 colours
  (incl. orange) live once as `--c-<name>*` tokens in `:root`; the colour classes
  and both families read them. `[teal text]{.teal .bg-pink}`, `::: {.circle .border-teal}`.
- **Scale:** `.scale-25 … .scale-500`, or `.scale` with `--scale`.
- **Shade:** `.light`, `.dark`.
- **Order:** `.cascade-2 … .cascade-5`.
- **Timing:** `.fast`, `.slow`, or `.dur-…`/`.delay-…` setting `--dur`/`--delay`,
  so transition and fragment timing are global knobs, not per-component values.
- **Position** (see next section).
- **Reveal behaviour** (external): `.fragment` and effects, `.columns`/`.column`,
  `.r-fit-text`.

Usage is always composition: `[x]{.flare .yellow}`, `::: {.panel .teal .scale-150}`,
never a fused `.panel-teal`.

### No bespoke widget classes; semantic names are aliases

Avoid `.my-special-widget` styling that bakes in pixel values and colours. If a
named, semantic class is wanted, define it as a thin **alias** that only sets the
global knobs and composes existing components, for example:

```css
/* alias: sets knobs + reuses a component, no bespoke values */
.warning { --hue: var(--yellow); }      /* used as .callout.warning */
.title-card { --scale: 2; --hue: var(--navy); }  /* used as .card.title-card */
```

So a semantic name never introduces a new appearance; it is a preset of the same
variables the primitives already read. New looks come from new knob values, not
new bespoke rules.

## Position: alignment, float, and percentage coordinates

A full, orthogonal position axis:

- **Alignment:** `.left`/`.center`/`.right` (and `.top`/`.middle`/`.bottom` for
  vertical) for flow alignment.
- **Float/place:** `.place` sets `position:absolute` within the (positioned)
  slide, so coordinates apply.
- **Percentage coordinate utilities (stepped):** `.top-0 … .top-100`,
  `.left-0 … .left-100` (and `.right-…`, `.bottom-…`) in 5% steps, each setting
  e.g. `top: 25%`. Class names use no `%` sign, so `.top-25` means `top:25%`.
  These stepped utilities are generated from the manifest (below) rather than
  hand-written, to keep the file maintainable.
- **Arbitrary coordinates (attributes):** for values off the step, attributes in
  `parseAttrs` compile to inline style exactly like the existing `width=`/
  `height=`: `[x]{.place top=37% left=12%}` → `position:absolute;top:37%;left:12%`.

So position composes from alignment (classes) + float (`.place`) + coordinates
(stepped utility classes or arbitrary attributes), all reachable through paths
gmist already has.

## Plan

### Phase 1: portable framework + picker as the sole catalogue

- Move the house framework into gmist as `app/styles/deck-base.css`; serve it as
  the default stylesheet for every doc. Per-deck `css:` layers after it.
- Make the `.` picker the single catalogue (it already reads the CSS live). Turn
  `HelpPanel` from an exhaustive (drifting) list into an axes explainer: the
  grammar (component × colour × scale × shade × order × timing × position) plus
  "type `.` to list this deck's classes". Keep one annotated `BUILTIN_CLASSES`
  list for the external reveal/Quarto classes only.
- Delete the parallel hardcoded lists (HelpPanel exhaustive list, the README
  catalogue, the CSS header `STYLE MAP` comment) once the picker covers them.

### Phase 2: positioning

- Implement the position axis above: alignment classes, `.place`, the stepped
  percentage utilities, and `left=`/`top=`/`x=`/`y=` attributes in `parseAttrs`.

### Phase 3: a machine-readable manifest (the fullest single source)

- Add `app/styles/classes.json`: axis → class → one-line description, plus the
  step definitions (colours, scale steps, percentage steps). gmist reads it to
  drive a grouped, described picker and the help panel; a build script generates
  the stepped utility rules in `deck-base.css` and the README catalogue from it.
- Then one manifest describes the system, the CSS implements it, and the help,
  the picker, the generated utilities and the README all derive from it.

## Guiding rule

One editable CSS file owns appearance and "what exists"; the picker reads it; a
manifest (phase 3) describes it and generates the stepped utilities and docs.
Components read global knobs, the colour/scale/timing classes only set them, and
semantic names are aliases over those knobs. Nothing hardcodes a parallel list,
and nothing bakes in a bespoke widget look.
