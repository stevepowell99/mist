/**
 * The controls that sit over a deck while presenting, shared by both editors so
 * Present is one thing rather than two that drifted.
 *
 * They are buttons rather than only a hover zone and a chord. Notes and the
 * slide list were reachable by Ctrl/Cmd+Alt+N and Ctrl/Cmd+Alt+D, or by finding
 * an invisible strip at the screen edge, which is not a way anyone discovers
 * that a presenter view exists at all. The chords and the hover still work; this
 * is the visible answer to "where are my speaker notes".
 *
 * Deliberately quiet: low-contrast on the black surround, so a projected slide
 * is not framed by our own furniture. They sit top-right, out of the slide's
 * way, and the labels say what you get rather than what they toggle.
 */
export default function PresentControls({
  notesOpen,
  slidesOpen,
  speakerHref,
  onToggleNotes,
  onToggleSlides,
  onExit,
}: {
  notesOpen: boolean;
  slidesOpen: boolean;
  /**
   * The deck's standalone page, for presenting on two screens. Notes here are
   * a card on the SAME screen, which is right for rehearsing and wrong for a
   * projector, where the audience would read them. reveal's own speaker view
   * puts them in a second window, and it only works on a standalone page (a
   * sandboxed srcDoc iframe has no URL for it to open), so that is where this
   * sends you rather than trying to copy it.
   */
  speakerHref?: string;
  onToggleNotes: () => void;
  onToggleSlides: () => void;
  onExit: () => void;
}) {
  const cls = (on: boolean) =>
    `cursor-pointer rounded px-2 py-1 text-xs uppercase tracking-wider transition-colors ${
      on ? "bg-white/25 text-white" : "bg-black/40 text-white/70 hover:text-white"
    }`;
  return (
    <div className="absolute right-3 top-3 z-50 flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleSlides}
        title="Slide list (Ctrl/Cmd+Alt+D)"
        aria-pressed={slidesOpen}
        className={cls(slidesOpen)}
      >
        Slides
      </button>
      <button
        type="button"
        onClick={onToggleNotes}
        title="Speaker notes, next slide and timer (Ctrl/Cmd+Alt+N)"
        aria-pressed={notesOpen}
        className={cls(notesOpen)}
      >
        Notes
      </button>
      {speakerHref && (
        <a
          href={speakerHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Two screens: opens the deck's own page, where Notes gives reveal's speaker view in a second window"
          className={cls(false)}
        >
          Speaker view
        </a>
      )}
      <button type="button" onClick={onExit} title="Exit present (Esc)" aria-label="Exit present" className={cls(false)}>
        Exit
      </button>
    </div>
  );
}
