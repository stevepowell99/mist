import { marked } from "marked";
import DOMPurify from "dompurify";
import { applyGrammar, stripFrontmatter } from "~/lib/slides-build";

/** Render a slide fragment's markdown to styled HTML for a thumbnail, the same
 *  way the document Preview does: the house grammar is global CSS, so a `.preview`
 *  box renders panels/cards/colours without a reveal iframe. Shared by the library
 *  gallery thumbnails and the presenter rail's next-slide preview. */
export function slideThumbHtml(md: string): string {
  const converted = applyGrammar(stripFrontmatter(md).body);
  return DOMPurify.sanitize(marked.parse(converted, { async: false }) as string);
}

/** The text of a slide's `::: {.notes}` block (speaker notes), or "" if none. */
export function slideNotes(raw: string): string {
  const m = raw.match(/:{3,}\s*\{[^}]*\.notes\b[^}]*\}\s*\n([\s\S]*?)\n\s*:{3,}/);
  return m ? m[1].trim() : "";
}
