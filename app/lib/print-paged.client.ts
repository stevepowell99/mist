// Typeset-ish print for documents using Paged.js. It paginates the already
// rendered preview into real pages (A4, margins, running title, page numbers,
// controlled breaks) and prints them, without ever showing the paginated layout
// on screen: the pages are built in an off-screen container that becomes the
// only printed thing (see the @media print block in app.css). A step up from a
// plain window.print() dump without needing a server.
//
// Paged.js renders into the SAME document, so the paginated `.preview` inherits
// all the preview/grammar/theme CSS already in the page head for free; the only
// stylesheet we feed it is the @page rules below (page size, margin boxes,
// break hints). Loaded only on demand (dynamic import) so it stays out of the
// initial bundle and never runs during SSR. Decks keep their own /slides path.

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
 * Paginate the live `.preview` element off-screen and open the print dialog.
 * Nothing is shown on screen at any point; the off-screen container is the only
 * thing the @media print rules reveal. Cleanup runs on afterprint, on the window
 * regaining focus (the dialog closing, success or cancel), and on a safety
 * timeout, so a print never leaves an intermediate behind. Returns false if
 * there is nothing to print or Paged.js fails, so the caller can fall back to a
 * plain window.print().
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

  // Fresh off-screen container each run.
  document.getElementById(PRINT_ROOT_ID)?.remove();
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  document.body.appendChild(root);
  document.body.classList.add(PRINTING_CLASS);

  let done = false;
  let safety = 0;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (safety) window.clearTimeout(safety);
    document.body.classList.remove(PRINTING_CLASS);
    document.getElementById(PRINT_ROOT_ID)?.remove();
    window.removeEventListener("afterprint", cleanup);
    window.removeEventListener("focus", onFocus);
  };
  // The print dialog blurs the window; closing it (printed or cancelled) returns
  // focus. Ignore the focus event the opening click itself fires.
  let armed = false;
  const onFocus = () => {
    if (armed) cleanup();
  };
  window.addEventListener("afterprint", cleanup);
  window.addEventListener("focus", onFocus);

  const content = `<div class="preview">${source.innerHTML}</div>`;
  try {
    const previewer = new Previewer();
    await previewer.preview(content, [{ print: pageCss(title) }], root);
  } catch (err) {
    console.error("Paged.js pagination failed", err);
    cleanup();
    return false;
  }

  // Let the paginated pages settle, then print. Arm the focus fallback only
  // after the dialog has been asked for.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      armed = true;
      safety = window.setTimeout(cleanup, 120000);
      window.print();
    }),
  );
  return true;
}
