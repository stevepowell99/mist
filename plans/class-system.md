# Dimensional class system: unify and simplify

Status: plan, not started (16 June 2026).

The slide/doc styling is one clean grammar, but its catalogue (the list of what
exists) is hardcoded in several places that drift from the real CSS. This plan
keeps the CSS as the single source of truth for both appearance and existence,
and removes the parallel hardcoded lists.

## The grammar (one orthogonal model)

Every styled element is a composition of orthogonal axes:

- Component: `.flare`/`.hl`, `.panel`, `.bg`, `.chip`, `.card`/`.cards`, `.bignum`, `.callout`
- Colour (variable-only, shows nothing alone): `.blue .cyan .teal .green .mint .yellow .pink .mag .navy .grey .white .black`, each setting `--hue`, `--hue-bright`, `--hue-pale`, `--hue-deep`, `--on`
- Scale: `.scale-25 ... .scale-500`, or `.scale` with `--scale`
- Shade: `.light`, `.dark`
- Order: `.cascade-2 ... .cascade-5`
- Position: `.left`/`.center`/`.right` (alignment), `.place` (float); plus arbitrary placement that the OLD slides app had (`left`/`top`) and mist does not
- Reveal behaviour: `.fragment` and its effects, `.columns`/`.column`, `.r-fit-text`, etc. (reveal/Quarto, not in the deck CSS)

Usage is always composition: `[x]{.flare .yellow}`, `::: {.panel .teal}`, never a fused `.panel-teal`.

## Where each piece lives today

| Concern | Location | SSoT? |
|---|---|---|
| Appearance of the composable classes | `19c-slides/_shared/styles.css` | yes (correct) |
| Per-deck palette override + one-offs | each deck's own `.css` | yes (correct) |
| Pandoc attr to HTML (`{.x #id style= width= height=}`) | mist `app/lib/slides-build.ts` (`parseAttrs`, `convertSpans/Divs/Images`, `parseHeading`) | yes |
| The `.` picker catalogue | mist `app/lib/cm-classes.ts`: `parseCssClasses` reads the deck CSS live, plus a hardcoded `BUILTIN_CLASSES` for reveal/Quarto | mixed |
| In-app help catalogue | mist `app/components/HelpPanel.tsx` `CLASS_GROUPS` (hardcoded) | NO, drifts |
| User catalogue | `19c-slides/README.md` (hardcoded) | NO, drifts |
| Human style map | `STYLE MAP` comment in `_shared/styles.css` | NO, drifts |

## The problem

Appearance has a clean single source (the CSS). What is sprawled is the
catalogue of what exists, hardcoded in roughly four places (HelpPanel,
BUILTIN_CLASSES for the reveal set, the README, the CSS header comment). They
drift: adding `.white`/`.black` to the CSS on 16 June left the HelpPanel list
stale immediately. Only the `.` picker is correct, because it derives from the
CSS at runtime (`parseCssClasses`).

## Plan

### Phase 1: make the CSS the sole catalogue; delete the hardcoded lists

- Keep `_shared/styles.css` as the single source for appearance AND existence of
  the composable classes. The picker already derives from it, so it never
  drifts.
- Turn `HelpPanel` from an exhaustive (drifting) list into an axes explainer:
  describe the grammar (component x colour x scale x shade x order x position)
  and say "type `.` to list this deck's classes". The picker is the exhaustive
  reference; the help is the mental model.
- Keep ONE annotated list in mist for the genuinely-external reveal/Quarto
  classes (`.fragment` and effects, `.columns`, `.r-fit-text`, callouts). These
  are not in the deck CSS, so that list is legitimately mist's, not a duplicate.
  It already exists as `BUILTIN_CLASSES` in `cm-classes.ts`; keep it as the one
  home, optionally annotated with a group + one-line description.

Outcome: no mist file hardcodes a parallel list of the composable classes; the
help stops drifting; the picker stays the source of truth for "what exists".

### Phase 2: fold positioning back in, consistently

- Re-add arbitrary placement (the old app's `left`/`top`) as attributes in
  `parseAttrs`, exactly like the existing `width=`/`height=` to inline style:
  support `left=`, `top=` (and optionally `x=`, `y=`) so `[x]{.place left=2em
  top=3em}` compiles to `position:absolute;left:2em;top:3em`.
- Keep `.left`/`.center`/`.right` for alignment and `.place` for float, defined
  in the CSS. So the position axis is: alignment (CSS classes) + float (`.place`)
  + arbitrary coordinates (attributes), all reachable through paths mist already
  has.

### Phase 3 (optional, the fullest SSoT): a machine-readable manifest

- Add a small `_shared/classes.json` (or `.yml`) next to the stylesheet: axis to
  class to one-line description. mist reads it the way it reads css/bib, to drive
  a GROUPED, DESCRIBED picker and the help panel; a build script generates the
  README catalogue from it.
- Then one file describes the system, the CSS implements it, and the help, the
  picker and the README are all generated. Per-deck CSS can extend the manifest
  for deck-specific additions.

## Recommendation

Do Phase 1 and Phase 2 now: they remove the drift and restore positioning with
little code. Treat Phase 3 as the upgrade if grouped/described autocomplete and
auto-generated docs are wanted.

Guiding rule (matches the single-source-of-truth instinct): the CSS owns
appearance, the picker owns "what exists" by reading the CSS, and nothing
hardcodes a parallel list. The only list mist keeps is the external reveal/Quarto
set that is not in any deck CSS.

## Cross-repo note

The shared stylesheet lives in the `19c-slides` repo (the slide project owns its
styling); mist is a viewer that reads it through the asset proxy. Keep that
separation. The unification is about removing mist's hardcoded catalogues and
deriving from the CSS, not about moving the CSS into mist. The matching catalogue
cleanup in `19c-slides` (README, STYLE MAP comment) is tracked in that repo's
own notes.
