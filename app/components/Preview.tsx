import { useMemo, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImages } from "~/lib/asset-urls";
import { runMermaid } from "~/lib/mermaid";
import { renderWikiLinks } from "~/lib/wikilinks";
import { convertCitations, formatReferenceList } from "~/lib/citations";
import { convertCallouts, convertSpans, convertImages, convertDivs, maskCode, restoreCode } from "~/lib/slides-build";
import { themeCss } from "~/lib/themes";
import { stripFrontmatter } from "~/lib/thread-serialization";
import { stripMistBanner } from "~/shared/mist-banner";

/** Strip pandoc attribute blocks left on heading lines, e.g. "## Title {#anchor}".
 * Runs AFTER the grammar conversions, so only leftover heading attrs remain.
 * Only blocks starting with # or . are removed, so CriticMarkup ({++ ++} etc.) is left alone. */
function stripPandocAttrs(text: string): string {
  return text.replace(/[ \t]*\{[#.][^}]*\}[ \t]*$/gm, "");
}

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown, drive, bibLib, assetToken, frontmatter } = useDocument();
  const containerRef = useRef<HTMLDivElement>(null);

  // The same theme CSS the deck iframe injects, so a themed document reads the
  // same as a deck. Scoped to :is(.reveal,.preview), so it only touches .preview.
  const themeStyle = useMemo(() => themeCss(frontmatter ?? ""), [frontmatter]);

  // DOMPurify needs a DOM, which the Cloudflare Worker has none of, so the
  // markdown render only runs after hydration. With a Preview share link the
  // page can mount with Preview already showing, hence the client-only gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect

  const html = useMemo(() => {
    if (!mounted) return "";
    const ctx = {
      drive,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      driveToken: drive ? assetToken ?? "" : "",
    };
    // The editor body now carries the document's YAML frontmatter (so it is
    // visible and editable), but it is metadata, so strip it from the preview.
    const resolved = rewriteImages(stripFrontmatter(stripMistBanner(markdown)), ctx);
    // Parse the composable grammar (callouts -> spans -> fenced divs, nesting
    // supported) so panels, cards and callouts render in a doc, then clean any
    // attrs left on heading lines. Mask code first so example syntax shown in
    // `backticks` or a fenced block is never rewritten; restore it at the end.
    const masked = maskCode(resolved);
    const withLinks = restoreCode(
      stripPandocAttrs(
        convertDivs(convertImages(convertSpans(convertCallouts(renderWikiLinks(masked.text))))),
      ),
      masked.tokens,
    );
    let body = withLinks;
    let references = "";
    if (bibLib) {
      const { text, usedKeys } = convertCitations(withLinks, bibLib);
      body = text;
      references = formatReferenceList(usedKeys, bibLib);
    }
    const withCritic = renderCriticMarkup(body);
    const raw = (marked.parse(withCritic, { async: false }) as string) + references;
    return DOMPurify.sanitize(raw);
  }, [mounted, markdown, drive, bibLib, assetToken]);

  // Render any mermaid code blocks into diagrams once the HTML is in the DOM.
  useEffect(() => {
    void runMermaid(containerRef.current);
  }, [html]);

  return (
    <>
      <style>{themeStyle}</style>
      <div
        ref={containerRef}
        className="preview font-serif"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
