import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { rewriteImageUrls } from "~/lib/github";
import { renderWikiLinks } from "~/lib/wikilinks";

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown, github } = useDocument();

  const html = useMemo(() => {
    const resolved = github ? rewriteImageUrls(markdown, github) : markdown;
    const withLinks = renderWikiLinks(resolved);
    const withCritic = renderCriticMarkup(withLinks);
    const raw = marked.parse(withCritic, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown, github]);

  return (
    <div
      className="preview font-serif"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
