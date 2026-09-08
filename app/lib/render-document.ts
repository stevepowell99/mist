import { marked } from "marked";
import DOMPurify from "dompurify";
import { rewriteImages } from "~/lib/asset-urls";
import { convertCitations, formatReferenceList } from "~/lib/citations";
import { applyGrammar } from "~/lib/slides-build";
import { renderCriticHtml } from "~/lib/critic";
import { insertPosAnchors } from "~/lib/source-anchors";
import { stripFrontmatter } from "~/lib/thread-serialization";
import { stripMistBanner } from "~/shared/mist-banner";
import type { DriveMeta } from "~/shared/types";
import type { BibLibrary } from "~/lib/citations";

/** Strip pandoc attribute blocks left on heading lines, e.g. "## Title {#anchor}".
 * Runs AFTER the grammar conversions, so only leftover heading attrs remain.
 * Only blocks starting with # or . are removed, so CriticMarkup ({++ ++} etc.) is left alone. */
function stripPandocAttrs(text: string): string {
  return text.replace(/[ \t]*\{[#.][^}]*\}[ \t]*$/gm, "");
}

export interface RenderContext {
  /** For rewriting relative image paths; null for a document with no folder. */
  drive: DriveMeta | null;
  origin: string;
  driveToken: string;
  /** Parsed BibTeX, when the document names a library. */
  bibLib: BibLibrary | null;
}

/**
 * A markdown document as HTML.
 *
 * One function, because there are now two editors that show a preview and the
 * repo's rule is that the composable-grammar pipeline is called rather than
 * re-inlined. It is pure: text in, sanitised HTML out, no React and no DOM
 * beyond DOMPurify, so it can be tested directly and cannot drift between the
 * two call sites.
 */
export function renderDocumentHtml(markdown: string, ctx: RenderContext): string {
  // The editor body carries the document's own YAML frontmatter, so it is
  // visible and editable, but it is metadata: strip it from the preview.
  const source = stripFrontmatter(stripMistBanner(markdown));
  // Both strips take content off the FRONT, so what is left is a suffix and the
  // length difference is the offset back into the editor document. The check
  // keeps the anchors honest if that ever stops being true.
  const base = markdown.endsWith(source) ? markdown.length - source.length : 0;
  // Scroll anchors: one hidden marker per block carrying its source offset, so a
  // split view can map editor position to preview pixels (source-anchors.ts).
  const resolved = rewriteImages(insertPosAnchors(source, base), ctx);
  // The shared composable-grammar pipeline (callouts, spans, divs, bignums, with
  // code masked) plus wikilinks and a heading-attribute strip, so a document
  // reads exactly like a deck slide.
  const withLinks = applyGrammar(resolved, { wikilinks: true, afterConvert: stripPandocAttrs });

  let body = withLinks;
  let references = "";
  if (ctx.bibLib) {
    const { text, usedKeys } = convertCitations(withLinks, ctx.bibLib);
    body = text;
    references = formatReferenceList(usedKeys, ctx.bibLib);
  }

  const withCritic = renderCriticHtml(body);
  const raw = (marked.parse(withCritic, { async: false }) as string) + references;
  return DOMPurify.sanitize(raw);
}
