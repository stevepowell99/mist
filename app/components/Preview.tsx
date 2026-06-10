import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImageUrls } from "~/lib/github";
import { renderWikiLinks } from "~/lib/wikilinks";
import { convertCitations, formatReferenceList } from "~/lib/citations";

/** Strip pandoc attribute blocks from heading lines, e.g. "## Title {#anchor}".
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

// Repos whose ((id)) wikilinks resolve to a published site. The Garden content
// repo publishes at garden.causalmap.app; extend this map for other sites.
const PUBLISHED_SITES: Record<string, string> = {
  "causal-mapping-garden-content": "https://garden.causalmap.app",
};

export default function Preview() {
  const { markdown, github, bibLib } = useDocument();

  const html = useMemo(() => {
    const resolved = github ? rewriteImageUrls(markdown, github) : markdown;
    const siteBase = github ? PUBLISHED_SITES[github.repo] ?? null : null;
    const withLinks = stripPandocAttrs(renderWikiLinks(resolved, siteBase));
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
  }, [markdown, github, bibLib]);

  return (
    <div
      className="preview font-serif"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
