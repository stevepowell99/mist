import { useMemo, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImages } from "~/lib/asset-urls";
import { runMermaid } from "~/lib/mermaid";
import { renderWikiLinks } from "~/lib/wikilinks";
import { convertCitations, formatReferenceList } from "~/lib/citations";
import { stripFrontmatter } from "~/lib/thread-serialization";
import { stripMistBanner } from "~/shared/mist-banner";

/** Strip pandoc attribute blocks from heading lines, e.g. "## Title {#anchor}".
 * Only blocks starting with # or . are removed, so CriticMarkup ({++ ++} etc.) is left alone. */
function stripPandocAttrs(text: string): string {
  return text.replace(/[ \t]*\{[#.][^}]*\}[ \t]*$/gm, "");
}

/** Remove Quarto fenced-div markers (`:::`, `::: {.columns}`) so they do not
 * render as stray colons in the document preview. */
function stripFencedDivs(text: string): string {
  return text.replace(/^[ \t]*:::+.*$/gm, "");
}

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

// Repos whose ((id)) wikilinks resolve to a published site. The Garden content
// repo publishes at garden.causalmap.app; extend this map for other sites.
const PUBLISHED_SITES: Record<string, string> = {
  "causal-mapping-garden-content": "https://garden.causalmap.app",
};

export default function Preview() {
  const { markdown, github, drive, bibLib, assetToken } = useDocument();
  const containerRef = useRef<HTMLDivElement>(null);

  // DOMPurify needs a DOM, which the Cloudflare Worker has none of, so the
  // markdown render only runs after hydration. With a Preview share link the
  // page can mount with Preview already showing, hence the client-only gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect

  const html = useMemo(() => {
    if (!mounted) return "";
    const ctx = {
      github,
      drive,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      driveToken: drive ? assetToken ?? "" : "",
    };
    // The editor body now carries the document's YAML frontmatter (so it is
    // visible and editable), but it is metadata, so strip it from the preview.
    const resolved = rewriteImages(stripFrontmatter(stripMistBanner(markdown)), ctx);
    const siteBase = github ? PUBLISHED_SITES[github.repo] ?? null : null;
    const withLinks = stripFencedDivs(stripPandocAttrs(renderWikiLinks(resolved, siteBase)));
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
  }, [mounted, markdown, github, drive, bibLib, assetToken]);

  // Render any mermaid code blocks into diagrams once the HTML is in the DOM.
  useEffect(() => {
    void runMermaid(containerRef.current);
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="preview font-serif"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
