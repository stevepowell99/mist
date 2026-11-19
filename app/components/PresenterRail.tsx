import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { deckSlides } from "~/lib/slides-build";
import { slideThumbHtml, slideNotes } from "~/lib/slide-thumb";
import { themeCss } from "~/lib/themes";
import type { DeckStep } from "~/lib/usePresent";

/** mm:ss (or h:mm:ss past an hour) elapsed since the talk started. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Keys a presenter, or a clicker, uses to step a deck: what reveal itself answers to. */
const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "n", "N"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "p", "P"]);

/**
 * What the presenter sees: time since the talk started, where you are (N/M),
 * the current slide's `::: {.notes}`, and the top-left of the NEXT slide. All
 * from the document, so there is no second deck to keep in step.
 *
 * Two forms. `window` fills the floating speaker window that Present opens, the
 * one to use when the deck window is shared or projected: it steps the deck
 * from its own buttons and keys, so a clicker works whichever window has focus.
 * `card` is the fallback on the presenting screen itself, for when no window
 * would open: it is visible to anyone watching that screen.
 */
export default function PresenterRail({
  markdown,
  frontmatter,
  currentSlide,
  startedAt,
  onMouseLeave,
  variant = "card",
  onStep,
  onExit,
}: {
  markdown: string;
  frontmatter: string;
  currentSlide: number;
  startedAt: number;
  onMouseLeave?: () => void;
  variant?: "card" | "window";
  onStep?: (dir: DeckStep) => void;
  onExit?: () => void;
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
  const inWindow = variant === "window";

  // Tick the clock once a second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The speaker window's own keys: it is a separate window, so with the focus
  // in it the deck's arrow keys never fire unless they are passed on.
  const rootRef = useRef<HTMLElement | null>(null);
  const stepRef = useRef(onStep);
  const exitRef = useRef(onExit);
  useEffect(() => {
    stepRef.current = onStep;
    exitRef.current = onExit;
  }, [onStep, onExit]);
  useEffect(() => {
    if (!inWindow) return;
    const w = rootRef.current?.ownerDocument.defaultView;
    if (!w) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (NEXT_KEYS.has(e.key)) stepRef.current?.("next");
      else if (PREV_KEYS.has(e.key)) stepRef.current?.("prev");
      else if (e.key === "Escape") exitRef.current?.();
      else return;
      e.preventDefault();
    };
    w.addEventListener("keydown", onKey);
    return () => w.removeEventListener("keydown", onKey);
  }, [inWindow]);

  const btn =
    "cursor-pointer rounded border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-ink hover:bg-border";

  const nextPreview = (
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
  );

  const notes = notesHtml ? (
    <div
      className={
        inWindow
          ? "min-h-0 flex-1 overflow-y-auto text-lg leading-relaxed text-ink [&_p]:mb-3"
          : "max-h-48 overflow-y-auto text-sm leading-relaxed text-ink [&_p]:mb-2"
      }
      dangerouslySetInnerHTML={{ __html: notesHtml }}
    />
  ) : (
    <p className={inWindow ? "min-h-0 flex-1 text-sm text-muted" : "text-sm text-muted"}>
      No notes. Add a <span className="font-mono">/notes</span> block.
    </p>
  );

  return (
    <aside
      ref={rootRef}
      onMouseLeave={onMouseLeave}
      className={
        inWindow
          ? "flex h-full flex-col gap-3 bg-paper p-4 text-ink"
          : "absolute right-3 top-1/2 z-50 flex max-h-[92vh] w-[360px] -translate-y-1/2 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-paper/95 p-3 text-ink shadow-2xl backdrop-blur"
      }
    >
      <style>{themeStyle}</style>
      <div className="flex items-baseline justify-between gap-3 font-mono text-sm">
        <span className="text-ink">{cur + 1} / {total}</span>
        {inWindow && slides[cur]?.title && (
          <span className="min-w-0 flex-1 truncate font-sans text-muted">{slides[cur].title}</span>
        )}
        <span className="text-muted">{clock(now - startedAt)}</span>
      </div>
      {inWindow && (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => onStep?.("prev")} title="Previous (Left, Page Up)">
            ◀ Back
          </button>
          <button type="button" className={btn} onClick={() => onStep?.("next")} title="Next (Right, Space, Page Down)">
            Next ▶
          </button>
          <span className="flex-1" />
          <button type="button" className={btn} onClick={() => onExit?.()} title="End the presentation (Esc)">
            End
          </button>
        </div>
      )}
      {inWindow ? (
        <>
          {notes}
          {nextPreview}
          <p className="text-xs text-muted">
            Share the slides window, not this one. F in the slides goes full screen.
          </p>
        </>
      ) : (
        <>
          {nextPreview}
          {notes}
        </>
      )}
    </aside>
  );
}
