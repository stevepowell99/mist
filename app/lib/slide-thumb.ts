import { marked } from "marked";
import DOMPurify from "dompurify";
import { applyGrammar, stripFrontmatter } from "~/lib/slides-build";
import { renderCriticHtml } from "~/lib/critic";
import { insertPosAnchors } from "~/lib/source-anchors";

/** Render a slide fragment's markdown to styled HTML for a thumbnail, the same
 *  way the document Preview does: the house grammar is global CSS, so a `.preview`
 *  box renders panels/cards/colours without a reveal iframe. Shared by the library
 *  gallery thumbnails and the presenter rail's next-slide preview. */
export function slideThumbHtml(md: string): string {
  const converted = applyGrammar(stripFrontmatter(md).body);
  return DOMPurify.sanitize(marked.parse(converted, { async: false }) as string);
}

/** Render a slide for the live-preview widget: the same grammar as
 *  `slideThumbHtml`, plus a `data-pos` marker before each top-level block (so a
 *  click on the rendered slide can be mapped back to the source it replaces,
 *  the same anchors the split-view scroll sync uses) and CriticMarkup rendered
 *  as styled spans rather than left as literal `{++ ++}` braces, since a slide
 *  can carry a pending suggestion or comment while some other slide is the one
 *  being edited. `source` is already slide-relative (a `slideSpans` span's own
 *  text), so the anchors need no frontmatter offset. */
export function slideLiveHtml(source: string): string {
  const anchored = insertPosAnchors(source);
  const converted = applyGrammar(anchored);
  const withCritic = renderCriticHtml(converted);
  return DOMPurify.sanitize(marked.parse(withCritic, { async: false }) as string);
}

/** The text of a slide's `::: {.notes}` block (speaker notes), or "" if none. */
export function slideNotes(raw: string): string {
  const m = raw.match(/:{3,}\s*\{[^}]*\.notes\b[^}]*\}\s*\n([\s\S]*?)\n\s*:{3,}/);
  return m ? m[1].trim() : "";
}
