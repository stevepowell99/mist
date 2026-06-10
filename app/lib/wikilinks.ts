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

// Garden notes publish at a short permalink taken from a trailing ((id)) in the
// title, e.g. "005 ... ((minimalist))" is served at <site>/minimalist/.
const PAGE_ID_RE = /\(\(([^)]+)\)\)/;

/** The published permalink id for a wikilink target, or null if it has none. */
export function wikiLinkPageId(inner: string): string | null {
  const target = inner.split("|")[0];
  const m = PAGE_ID_RE.exec(target);
  return m ? m[1].trim() : null;
}

/**
 * Render Obsidian wikilinks. When `siteBase` is given and the target carries a
 * ((id)) permalink, link to the published page (<siteBase>/<id>/); otherwise
 * render readable but non-clickable styled text.
 */
export function renderWikiLinks(markdown: string, siteBase?: string | null): string {
  return markdown.replace(WIKILINK_RE, (_whole, inner: string) => {
    const display = escapeHtml(wikiLinkDisplay(inner));
    const id = siteBase ? wikiLinkPageId(inner) : null;
    if (siteBase && id) {
      const href = `${siteBase.replace(/\/$/, "")}/${encodeURIComponent(id)}/`;
      return `<a class="md-wikilink" href="${href}" target="_blank" rel="noopener noreferrer">${display}</a>`;
    }
    return `<span class="md-wikilink">${display}</span>`;
  });
}
