// Obsidian-style internal links: [[target]], [[target|alias]], [[target#heading]].
// Non-image embeds (![[note]]) are treated as links too. Image embeds (![[x.png]])
// are handled earlier by the image rewriter and should not reach here.
const WIKILINK_RE = /!?\[\[([^\]]+)\]\]/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Display text for a wikilink target: the alias if given, else the target without any #heading. */
export function wikiLinkDisplay(inner: string): string {
  const [target, alias] = inner.split("|");
  return (alias ?? target.split("#")[0]).trim();
}

/**
 * Render Obsidian wikilinks to readable styled text so Preview no longer shows
 * raw [[...]] brackets. Not yet clickable: resolving a target to a real URL
 * (a sibling repo note or its published page) is planned separately.
 */
export function renderWikiLinks(markdown: string): string {
  return markdown.replace(WIKILINK_RE, (_whole, inner: string) => {
    return `<span class="md-wikilink">${escapeHtml(wikiLinkDisplay(inner))}</span>`;
  });
}
