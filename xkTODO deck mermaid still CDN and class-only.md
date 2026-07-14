# Decks still load mermaid from a CDN and detect it by class only

Documents were fixed on 14 July 2026 (see `CLAUDE.md`, "Mermaid is bundled"), but
the deck runtime was not touched. `app/lib/slides-runtime.ts` still:

- pulls mermaid from jsdelivr at render time, so a blocked or slow CDN leaves every
  diagram in a deck as literal source text with nothing on the page to say why; and
- matches only `code.language-mermaid`, so a Quarto-style ```` ```{mermaid} ```` fence,
  or any path that strips the class, renders as its own source.

Fix by reusing what documents now do: bundle the import and detect by fence content
(`app/lib/mermaid.ts` has both, and the content regex is already exported-shaped).
The deck runs in a sandboxed iframe, so check the bundled import resolves there
before assuming it is a copy-paste.

Not urgent: no deck with a diagram has been reported broken. Raised while fixing the
document path, so it is written down rather than left in a session summary.
