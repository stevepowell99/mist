/**
 * The controls that sit over a deck while presenting, shared by both editors so
 * Present is one thing rather than two that drifted.
 *
 * They are buttons rather than only chords: Notes and the slide list were
 * reachable by Ctrl/Cmd+Alt+N and Ctrl/Cmd+Alt+D alone, which is not a way
 * anyone discovers that a presenter view exists at all.
 *
 * This window is the one being shared or projected, so the controls must not
 * frame the slide for the audience. While the speaker window is open, which has
 * its own End, Back and Next, they stay invisible until the pointer reaches the
 * top-right corner; without it they show faintly, as the only way out besides Esc.
 */
export default function PresentControls({
  notesOpen,
  slidesOpen,
  fullscreen,
  quiet,
  onToggleNotes,
  onToggleSlides,
  onToggleFullscreen,
  onExit,
}: {
  notesOpen: boolean;
  slidesOpen: boolean;
  fullscreen: boolean;
  /** Hide until hovered: the speaker window is open and carries the controls. */
  quiet: boolean;
  onToggleNotes: () => void;
  onToggleSlides: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
}) {
  const cls = (on: boolean) =>
    `cursor-pointer rounded px-2 py-1 text-xs uppercase tracking-wider transition-colors ${
      on ? "bg-white/25 text-white" : "bg-black/40 text-white/70 hover:text-white"
    }`;
  return (
    <div
      className={`absolute right-0 top-0 z-50 flex items-center gap-1 p-3 transition-opacity ${
        quiet && !slidesOpen ? "opacity-0 hover:opacity-100 focus-within:opacity-100" : ""
      }`}
    >
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
        title="Speaker notes, next slide and timer, in a window of their own (Ctrl/Cmd+Alt+N)"
        aria-pressed={notesOpen}
        className={cls(notesOpen)}
      >
        Notes
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        title="Full screen, for a projector (F)"
        aria-pressed={fullscreen}
        className={cls(fullscreen)}
      >
        Full screen
      </button>
      <button type="button" onClick={onExit} title="End the presentation (Esc)" aria-label="Exit present" className={cls(false)}>
        Exit
      </button>
    </div>
  );
}
