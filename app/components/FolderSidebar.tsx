import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import DriveBrowser from "~/components/DriveBrowser";

/**
 * Slide-out folder navigator for a Drive-backed document. It embeds the shared
 * DriveBrowser (search + browse, starting at the doc's own folder so siblings
 * show). The trigger sits in the header.
 */

export default function FolderSidebar() {
  const { drive } = useDocument();
  // Pinned by a click (stays, with a backdrop) or peeked by hover (closes when
  // the mouse leaves the trigger or panel), mirroring the right comment panel.
  // The trigger and panel are separate regions with a gap, so a short close
  // delay lets the mouse travel from one to the other without the peek closing.
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const open = pinned || peek;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPeek(false), 200);
  }, [cancelClose]);
  const openPeek = useCallback(() => {
    cancelClose();
    setPeek(true);
    setEverOpened(true);
  }, [cancelClose]);

  // The layout's shortcut handler (Ctrl/Cmd+Alt+F, from any focus) fires this
  // custom event; the open state lives here, so we toggle it here.
  useEffect(() => {
    const toggle = () => {
      setPeek(false);
      setPinned((v) => !v);
      setEverOpened(true);
    };
    window.addEventListener("mist-toggle-folder", toggle);
    return () => window.removeEventListener("mist-toggle-folder", toggle);
  }, []);

  if (!drive) return null;

  return (
    <>
      {/* Far-left hover zone: nudging the mouse to the left margin peeks the
          sidebar open, the same as hovering the trigger. */}
      <div
        onMouseEnter={openPeek}
        onMouseLeave={scheduleClose}
        aria-hidden="true"
        className="fixed bottom-0 left-0 top-[var(--header-h,0px)] z-30 w-1.5"
      />
      <button
        type="button"
        onClick={() => {
          setPinned((v) => !v);
          setEverOpened(true);
        }}
        onMouseEnter={openPeek}
        onMouseLeave={scheduleClose}
        title="Open from Drive (Ctrl/Cmd+Alt+F)"
        aria-label="Open from Drive"
        className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {pinned && (
        <button
          type="button"
          aria-label="Close folder"
          onClick={() => setPinned(false)}
          className="fixed inset-x-0 bottom-0 top-[var(--header-h,0px)] z-40 cursor-default bg-black/30"
        />
      )}
      {/* Kept mounted once opened so reopening shows the cached folder instantly.
          Opens below the header (--header-h) so the top bar stays usable.
          Hover peeks; leaving closes the peek but a pinned panel stays. */}
      {everOpened && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed left-0 top-[var(--header-h,0px)] z-50 flex h-[calc(100dvh-var(--header-h,0px))] w-[48rem] max-w-[95vw] flex-col border-r border-border bg-paper shadow-lg transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full pointer-events-none"}`}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="font-medium">Drive</span>
            <button
              type="button"
              onClick={() => {
                setPinned(false);
                setPeek(false);
              }}
              aria-label="Close"
              className="cursor-pointer px-2 text-lg leading-none"
            >
              &times;
            </button>
          </div>
          {drive ? (
            <DriveBrowser startFolderId={drive.folderId ?? null} currentFileId={drive.fileId} active={open} className="flex-1" />
          ) : null}
        </div>
      )}
    </>
  );
}
