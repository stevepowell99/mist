# Plan: internal links and Zotero references in Preview

Status: design, 10 June 2026. Covers two related Preview features: resolving Obsidian internal links to real targets, and rendering Zotero/BibTeX citations with a reference list. The first slice (render wikilinks as readable text, no longer raw `[[...]]`) is already shipped; this plans the clickable resolution and the citations.

## Internal links (`[[Note]]`, `[[Note|alias]]`)

Shipped: Preview renders wikilinks as their display text (alias, else target) in a styled `.md-wikilink` span, so the raw brackets are gone. Not yet clickable.

To make them resolve, mist needs to map a wikilink target to a real URL. The target is an Obsidian note reference, matched by filename or shortest path across the vault.

Approach:
- Build a repo file index from the GitHub tree API (`git/trees/<branch>?recursive=1`, public, no auth, CORS-enabled). Map both the filename without extension and the full path to the path. Cache it (it changes rarely); fetch once per document load, or store it in the agent at import time.
- Resolve `[[target]]` against the index (strip `#heading` and `|alias`). Obsidian uses shortest-unique-path matching; filename match covers most cases, full-path match disambiguates.
- Link target options, in order of usefulness:
  1. A sibling mist document, once folder import exists (the roadmap's folder navigation). `[[Note]]` opens the sibling doc with the same secret key. Best for collaborative review, but depends on folder mode.
  2. The published page, e.g. `garden.causalmap.app/<slug>`. Cleanest for readers, but the slug scheme is garden-specific, so it must be configurable per import (a base URL plus a slug rule), not hard-coded.
  3. The GitHub file (`github.com/<owner>/<repo>/blob/<branch>/<path>`). Generic, needs no config, always available for a public repo. Good default.

Decision (10 June 2026): link to the **garden site** (the published page), not the GitHub file. So the next step is to learn the garden's slug scheme from `build_static_site.py` (how a note title maps to a `garden.causalmap.app/...` URL), build the repo index, and resolve `[[Note]]` to that public URL. A configurable base URL keeps it general for other repos.

Recommended phasing:
1. Resolve via the repo index and the garden slug scheme, linking to the published page.
2. When folder import lands, optionally prefer the sibling mist doc.
3. Unresolved or ambiguous targets stay as plain styled text.

Unresolved or ambiguous targets remain readable text rather than a broken link.

## Zotero / BibTeX references

DONE 10 June 2026: Preview converts pandoc `[@key]` (and bracket groups, locators, `-@key` author suppression, bare `@key`) to inline APA, and appends an APA reference list of cited keys, mirroring `build_static_site.py`. The library is fetched from the repo (`assets/MyLibrary.bib`, with a few fallback paths) and parsed client-side; the fetch is lazy, on first Preview. Verified live: `[@powell...]` rendered as "(Powell et al. 2025)" linked to its DOI, with a References entry. `app/lib/citations.ts`. The Garden's own build still reads the machine-local Zotero export (`C:/Users/Zoom/Zotero-cm/My Library.bib`); the repo copy at `assets/MyLibrary.bib` is what mist uses, so keep that copy fresh (a build step could refresh it).

The original plan, for reference:

The roadmap already has "support a `My Library.bib` the way the Garden does, starting simple by showing a reference list at the bottom". This is the detailed plan.

Observed in the garden: notes use pandoc-style citations such as `[@powellWorkflowCollectingUnderstanding2025]`, so `[@key]` (and `[@k1; @k2]`) is the syntax to target. Still to confirm: where `My Library.bib` lives so mist can read it.

Pieces:
- Source the library. For a GitHub-backed doc, fetch a `.bib` from the repo (a known path such as `My Library.bib` at the repo root, or a path set at import). Public raw URL, no auth.
- Parse it. Use a BibTeX parser; `citation-js` also formats to CSL styles but is heavy, so weigh bundle size against a lighter parser plus a simple formatter.
- Detect citations in the markdown. Candidate syntaxes to confirm against the garden: pandoc `[@key]` and `[@k1; @k2]`, bare `@key`, or an Obsidian citation-plugin form. Match only keys present in the library.
- Render. Replace each citation with a formatted inline marker (for example `(Author, Year)`) linked to its entry, and append a `References` section at the bottom listing the cited entries in a chosen style.

Phasing:
1. Reference list at the bottom: parse the `.bib`, find cited keys in the document, list those entries formatted simply (author, year, title, source). No inline rewriting yet. This matches the roadmap's "start simple".
2. Inline citation rendering: replace `[@key]` with a linked `(Author, Year)`.
3. Optional niceties: hover preview of a reference, a configurable CSL style.

## Open questions

- Internal links: which target do you want first, the GitHub file (generic) or the published garden page (reader-facing but garden-specific)?
- Citations: what citation syntax do the garden notes actually use, and where does `My Library.bib` live (committed to the content repo, or elsewhere)? mist can only read it if it is reachable, ideally in the public repo.
- Formatting style for the reference list (a specific CSL style, or a plain author-year-title line to start).
