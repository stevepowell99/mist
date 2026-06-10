import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImageUrls } from "~/lib/github";
import { renderWikiLinks } from "~/lib/wikilinks";
import { convertCitations, formatReferenceList } from "~/lib/citations";

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown, github, bibLib } = useDocument();

  const html = useMemo(() => {
    const resolved = github ? rewriteImageUrls(markdown, github) : markdown;
    const withLinks = renderWikiLinks(resolved);
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
