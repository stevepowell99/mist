// Typeset-ish print for documents using Paged.js. It paginates the already
// rendered preview into real pages (A4, margins, running title, page numbers,
// controlled breaks) and hands the result to the browser's print dialog. A step
// up from a plain window.print() dump without needing a server: still
// browser-driven, but proper pagination. Decks keep their own /slides path.
//
// Paged.js renders into the SAME document, so the paginated `.preview` inherits
// all the preview/grammar/theme CSS already in the page head for free; the only
// stylesheet we feed it is the @page rules below (page size, margin boxes,
// break hints). Loaded only on demand (dynamic import) so it stays out of the
// initial bundle and never runs during SSR.

const PRINT_ROOT_ID = "paged-print-root";
const PRINTING_CLASS = "is-paged-printing";

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

/**
 * Paginate the live `.preview` element and open the print dialog. Returns false
 * if there is nothing to print or Paged.js fails, so the caller can fall back to
 * a plain window.print().
 */
export async function printDocumentPaged(title: string): Promise<boolean> {
  const source = document.querySelector(".preview");
  if (!source || !source.textContent?.trim()) return false;

  let Previewer: typeof import("pagedjs").Previewer;
  try {
    ({ Previewer } = await import("pagedjs"));
  } catch (err) {
    console.error("Paged.js failed to load", err);
    return false;
  }

  // Fresh container each run; a full-screen overlay on screen (a print preview),
  // and the only thing printed (see the @media print block in app.css).
  document.getElementById(PRINT_ROOT_ID)?.remove();
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  document.body.appendChild(root);
  document.body.classList.add(PRINTING_CLASS);

  const cleanup = () => {
    document.body.classList.remove(PRINTING_CLASS);
    document.getElementById(PRINT_ROOT_ID)?.remove();
    window.removeEventListener("afterprint", cleanup);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cleanup();
  };

  const content = `<div class="preview">${source.innerHTML}</div>`;
  try {
    const previewer = new Previewer();
    await previewer.preview(content, [{ print: pageCss(title) }], root);
  } catch (err) {
    console.error("Paged.js pagination failed", err);
    cleanup();
    return false;
  }

  window.addEventListener("afterprint", cleanup);
  document.addEventListener("keydown", onKey);
  // Let the paginated pages lay out before invoking print.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  return true;
}
