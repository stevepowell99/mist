import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import PresenterRail from "~/components/PresenterRail";
import PresentControls from "~/components/PresentControls";
import { stepDeck, type Present } from "~/lib/usePresent";

/**
 * What Present draws, for both editors: the deck (and any overlay the editor
 * adds, such as its slide list) as children, the controls, and the notes,
 * either portalled into the speaker window or, when none would open, as the
 * card on this screen. `currentSlide` must be the slide the deck reports, not
 * the editor cursor's, which does not move while the deck is stepped.
 */
export default function PresentLayer({
  present,
  markdown,
  frontmatter,
  currentSlide,
  slidesOpen,
  onToggleSlides,
  className,
  children,
}: {
  present: Present;
  markdown: string;
  frontmatter: string;
  currentSlide: number;
  slidesOpen: boolean;
  onToggleSlides: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      {children}
      {present.cardOpen && (
        <PresenterRail markdown={markdown} frontmatter={frontmatter} currentSlide={currentSlide} startedAt={present.startedAt} />
      )}
      <PresentControls
        notesOpen={present.notesShown}
        slidesOpen={slidesOpen}
        fullscreen={present.fullscreen}
        quiet={!!present.speakerRoot}
        onToggleNotes={present.toggleNotes}
        onToggleSlides={onToggleSlides}
        onToggleFullscreen={present.toggleFullscreen}
        onExit={present.exit}
      />
      {present.speakerRoot &&
        createPortal(
          <PresenterRail
            variant="window"
            markdown={markdown}
            frontmatter={frontmatter}
            currentSlide={currentSlide}
            startedAt={present.startedAt}
            onStep={stepDeck}
            onExit={present.exit}
          />,
          present.speakerRoot,
        )}
    </div>
  );
}
