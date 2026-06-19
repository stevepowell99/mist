// Typeset-ish print for documents. Mirrors the slide deck's print path: it opens
// a separate browser tab and paginates there with Paged.js, so the gmist editor
// window is NEVER touched and nothing can be left behind in it. The tab is a
// throwaway print view (grey backdrop, A4 pages, running title, page numbers);
// the user saves as PDF and closes it, exactly like the /slides print view.
//
// The tab is self-contained: it links the app's own stylesheets (so the
// preview/grammar styles match) plus the document's theme CSS, and loads the
// Paged.js polyfill, which auto-paginates and then opens the print dialog.

import { themeCss } from "~/lib/themes";

// Served copy of the Paged.js polyfill, staged into public/ by
// scripts/vendor-pagedjs.mjs (the package's exports map hides the dist file from
// a bundler import).
const POLYFILL_PATH = "/vendor/paged.polyfill.js";

/** @page rules plus print-only typography and break hints. The running title
 *  goes in the @top-left margin box; "n / m" in @bottom-right. */
function pageCss(title: string): string {
  const safe = title.replace(/["\\]/g, "");
  return `
    @page {
      size: A4;
      margin: 20mm 18mm 18mm;
      @top-left { content: "${safe}"; font: 9pt var(--font-serif, Georgia, serif); color: #9aa0a6; }
      @bottom-right { content: counter(page) " / " counter(pages); font: 9pt var(--font-serif, Georgia, serif); color: #9aa0a6; }
    }
    @page :first { @top-left { content: none; } }
    .preview { max-width: none; margin: 0; padding: 0; font-size: 11.5pt; line-height: 1.5; color: #111; }
    .preview h1, .preview h2, .preview h3 { break-after: avoid; }
    .preview pre, .preview table, .preview blockquote, .preview figure { break-inside: avoid; }
    .preview img { max-width: 100%; height: auto; }
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Fill an already-opened tab with the paginated document and open its print
 * dialog. The tab must be opened synchronously in the click handler (to survive
 * popup blockers) and passed in; this runs after the preview HTML is ready.
 */
export function fillPrintTab(
  win: Window,
  previewHtml: string,
  title: string,
  frontmatter: string,
): void {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  )
    .map((l) => `<link rel="stylesheet" href="${escapeHtml(l.href)}">`)
    .join("\n");
  const theme = themeCss(frontmatter ?? "");
  const polyfill = new URL(POLYFILL_PATH, window.location.origin).href;
  const dataTheme = document.documentElement.getAttribute("data-theme") ?? "";

  const doc = `<!doctype html>
<html data-theme="${escapeHtml(dataTheme)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${links}
<style>${theme}</style>
<style>${pageCss(title)}</style>
<style>
  html, body { margin: 0; }
  @media screen {
    body { background: #525659; }
    .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 0; }
    .pagedjs_page { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
  }
</style>
<script>
  window.PagedConfig = { auto: true, after: function () { window.focus(); window.print(); } };
</script>
<script src="${escapeHtml(polyfill)}"></script>
</head>
<body><div class="preview">${previewHtml}</div></body>
</html>`;

  win.document.open();
  win.document.write(doc);
  win.document.close();
}
