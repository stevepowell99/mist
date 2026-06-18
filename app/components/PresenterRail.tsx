import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { deckSlides } from "~/lib/slides-build";
import { slideThumbHtml, slideNotes } from "~/lib/slide-thumb";
import { themeCss } from "~/lib/themes";

/** mm:ss (or h:mm:ss past an hour) elapsed since the talk started. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * A small presenter card for the bottom-right corner in Present mode: time since
 * the talk started, where you are (N/M), the top-left of the NEXT slide, and the
 * current slide's `::: {.notes}`. All from the document, so no second deck and no
 * separate notes window. Shown on hover/shortcut; closes when the pointer leaves.
 */
export default function PresenterRail({
  markdown,
  frontmatter,
  currentSlide,
  startedAt,
  onMouseLeave,
}: {
  markdown: string;
  frontmatter: string;
  currentSlide: number;
  startedAt: number;
  onMouseLeave?: () => void;
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

  // Tick the clock once a second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside
      onMouseLeave={onMouseLeave}
      className="absolute right-3 top-1/2 z-50 flex max-h-[92vh] w-[360px] -translate-y-1/2 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-paper/95 p-3 text-ink shadow-2xl backdrop-blur"
    >
      <style>{themeStyle}</style>
      <div className="flex items-baseline justify-between font-mono text-sm">
        <span className="text-ink">{cur + 1} / {total}</span>
        <span className="text-muted">{clock(now - startedAt)}</span>
      </div>

      <div>
        <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Next</span>
        {next ? (
          /* Show the top-left of the next slide larger, rather than the whole
             slide tiny: zoom up and clip to roughly the top-left 60%. */
          <div className="h-[190px] w-full overflow-hidden rounded border border-border bg-white">
            <div className="preview origin-top-left" style={{ width: 1280, zoom: 0.45 }} dangerouslySetInnerHTML={{ __html: nextHtml }} />
          </div>
        ) : (
          <div className="flex h-12 items-center justify-center rounded border border-dashed border-border text-sm text-muted">
            End of deck
          </div>
        )}
        {next?.title && <span className="mt-1 block truncate text-xs text-muted">{next.title}</span>}
      </div>

      {notesHtml ? (
        <div className="max-h-48 overflow-y-auto text-sm leading-relaxed text-ink [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: notesHtml }} />
      ) : (
        <p className="text-sm text-muted">No notes. Add a <span className="font-mono">/notes</span> block.</p>
      )}
    </aside>
  );
}
