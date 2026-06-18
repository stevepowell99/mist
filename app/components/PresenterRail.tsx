import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { deckSlides } from "~/lib/slides-build";
import { slideThumbHtml, slideNotes } from "~/lib/slide-thumb";
import { themeCss } from "~/lib/themes";

/**
 * The presenter rail shown beside the slide in Present mode: where you are
 * (slide N of M), a live thumbnail of the NEXT slide, and the current slide's
 * speaker notes (its `::: {.notes}` block). All from the document markdown, so
 * no second deck and no separate notes window are needed.
 */
export default function PresenterRail({
  markdown,
  frontmatter,
  currentSlide,
}: {
  markdown: string;
  frontmatter: string;
  currentSlide: number;
}) {
  const slides = useMemo(() => deckSlides(markdown), [markdown]);
  const total = slides.length;
  const cur = Math.min(Math.max(0, currentSlide), Math.max(0, total - 1));
  const next = slides[cur + 1] ?? null;
  const nextHtml = useMemo(() => (next ? slideThumbHtml(next.raw) : ""), [next]);
  const notesHtml = useMemo(() => {
    const n = slides[cur] ? slideNotes(slides[cur].raw) : "";
    return n ? DOMPurify.sanitize(marked.parse(n, { async: false }) as string) : "";
  }, [slides, cur]);
  const themeStyle = useMemo(() => themeCss(frontmatter), [frontmatter]);

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-paper p-3 text-ink">
      <style>{themeStyle}</style>
      <div className="flex items-baseline justify-between">
        <span className="text-sm uppercase tracking-wider text-muted">Presenting</span>
        <span className="font-mono text-sm text-ink">{cur + 1} / {total}</span>
      </div>

      <div>
        <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Next</span>
        {next ? (
          <div className="h-40 w-full overflow-hidden rounded border border-border bg-white">
            <div className="preview origin-top-left px-3 py-2" style={{ width: 1280, zoom: 0.25 }} dangerouslySetInnerHTML={{ __html: nextHtml }} />
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center rounded border border-dashed border-border text-sm text-muted">
            End of deck
          </div>
        )}
        {next?.title && <span className="mt-1 block truncate text-xs text-muted">{next.title}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Notes</span>
        {notesHtml ? (
          <div className="flex-1 overflow-y-auto text-base leading-relaxed text-ink [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: notesHtml }} />
        ) : (
          <p className="text-sm text-muted">No notes on this slide. Add a <span className="font-mono">/notes</span> block.</p>
        )}
      </div>
    </aside>
  );
}
