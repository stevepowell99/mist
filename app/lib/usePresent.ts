import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Present, one mode for both editors: the deck fills this window, and the
 * speaker notes go in a small floating window of their own.
 *
 * The two-window shape is for presenting online. You share this window (or its
 * tab) and keep the notes window beside it, where the audience cannot see it,
 * and drive the talk from either one. Full screen is a separate step (F, or the
 * button), for a projector: Chrome leaves full screen whenever a page opens a
 * window, so the two cannot both happen on entering.
 *
 * The notes window is a Document Picture-in-Picture window where the browser has
 * one (Chrome and Edge), because that stays on top of everything; elsewhere it is
 * an ordinary popup, which TagFox's gmist window keeps on top by its name. When
 * neither will open, the notes fall back to the card on this screen.
 */

/** The popup's name, which TagFox's gmist window recognises and keeps on top. */
export const SPEAKER_WINDOW_NAME = "gmist-speaker";
const SPEAKER_W = 480;
const SPEAKER_H = 680;

/** The deck steps the way its own arrow keys do, fragments included. */
export type DeckStep = "next" | "prev";
/** Ask the shown deck to step: SlidesView passes it to its iframe. */
export function stepDeck(dir: DeckStep) {
  window.dispatchEvent(new CustomEvent<DeckStep>("mist-deck-nav", { detail: dir }));
}

type PipApi = { requestWindow: (o: { width: number; height: number }) => Promise<Window> };

/**
 * Electron (TagFox's gmist window) has the API but no window behind it:
 * requestWindow resolves with a 0x0 window that never shows (Electron 43,
 * measured 19 November 2026), so the notes would vanish. There the named popup
 * is used instead, and TagFox keeps it on top.
 */
const pipShowsNothing = () => typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);

async function openSpeakerWindow(): Promise<Window | null> {
  const pip = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
  if (pip?.requestWindow && !pipShowsNothing()) {
    try {
      return await pip.requestWindow({ width: SPEAKER_W, height: SPEAKER_H });
    } catch {
      // Refused or unsupported here; an ordinary popup is the next best thing.
    }
  }
  return window.open("", SPEAKER_WINDOW_NAME, `popup,width=${SPEAKER_W},height=${SPEAKER_H}`);
}

/**
 * Give the speaker window this app's stylesheets and theme, and an empty root to
 * render into. A popup reused by name still holds the last talk's page, so its
 * head and body are replaced rather than added to.
 */
function dressSpeakerWindow(w: Window): HTMLElement {
  const d = w.document;
  d.title = "Speaker notes";
  d.head.replaceChildren();
  for (const el of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    if (el instanceof HTMLLinkElement) {
      const l = d.createElement("link");
      l.rel = "stylesheet";
      l.href = el.href;
      d.head.append(l);
    } else {
      d.head.append(d.importNode(el, true));
    }
  }
  for (const a of Array.from(document.documentElement.attributes)) d.documentElement.setAttribute(a.name, a.value);
  d.documentElement.style.height = "100%";
  d.body.replaceChildren();
  d.body.className = "m-0 h-full bg-paper text-ink";
  const root = d.createElement("div");
  root.className = "h-full";
  d.body.append(root);
  return root;
}

export type Present = {
  presenting: boolean;
  startedAt: number;
  /** The speaker window's root, to portal the speaker view into; null when none is open. */
  speakerRoot: HTMLElement | null;
  /** The notes card on this screen, shown only when no speaker window would open. */
  cardOpen: boolean;
  fullscreen: boolean;
  /** Whether the notes are showing, in either form. */
  notesShown: boolean;
  enter: () => void;
  exit: () => void;
  toggleNotes: () => void;
  toggleFullscreen: () => void;
  closeCard: () => void;
};

export function usePresent(deck: boolean): Present {
  const [presenting, setPresenting] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [speaker, setSpeaker] = useState<{ win: Window; root: HTMLElement } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Mirrors for the window and message handlers, which outlive a render.
  const speakerRef = useRef(speaker);
  const presentingRef = useRef(presenting);
  useEffect(() => {
    speakerRef.current = speaker;
    presentingRef.current = presenting;
  }, [speaker, presenting]);
  /** Set while our own toggle leaves full screen, which keeps Present on. */
  const ownFsExit = useRef(false);

  const closeSpeaker = useCallback(() => {
    const s = speakerRef.current;
    speakerRef.current = null;
    setSpeaker(null);
    if (s && !s.win.closed) s.win.close();
  }, []);

  /** Open the notes window, or fall back to the card when it will not open. */
  const showNotes = useCallback(async () => {
    const open = speakerRef.current;
    if (open && !open.win.closed) {
      open.win.focus();
      return;
    }
    const w = await openSpeakerWindow();
    if (!w || !presentingRef.current) {
      if (w) w.close();
      else setCardOpen(true);
      return;
    }
    const root = dressSpeakerWindow(w);
    w.addEventListener("pagehide", () => setSpeaker((s) => (s?.win === w ? null : s)), { once: true });
    setCardOpen(false);
    speakerRef.current = { win: w, root };
    setSpeaker(speakerRef.current);
  }, []);

  const enter = useCallback(() => {
    if (!deck) return;
    setStartedAt(Date.now());
    setPresenting(true);
    presentingRef.current = true;
    void showNotes();
  }, [deck, showNotes]);

  const exit = useCallback(() => {
    presentingRef.current = false;
    setPresenting(false);
    setCardOpen(false);
    closeSpeaker();
    if (typeof document !== "undefined" && document.fullscreenElement) {
      ownFsExit.current = true;
      document.exitFullscreen?.().catch(() => {});
    }
  }, [closeSpeaker]);

  const toggleNotes = useCallback(() => {
    if (speakerRef.current) closeSpeaker();
    else if (cardOpen) setCardOpen(false);
    else void showNotes();
  }, [cardOpen, closeSpeaker, showNotes]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      ownFsExit.current = true;
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Esc leaves Present in one press. In full screen the browser takes that Esc to
  // leave full screen, so a full-screen exit we did not ask for ends Present too.
  useEffect(() => {
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setFullscreen(fs);
      if (!fs && presentingRef.current && !ownFsExit.current) exit();
      if (!fs) ownFsExit.current = false;
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [exit]);

  // The deck iframe forwards plain F (enter Present, or toggle full screen once
  // in it) and Esc, since its own window has the keys whenever it has focus.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const t = e.data === "mist-present" ? e.data : (e.data as { type?: string } | null)?.type;
      if (t === "mist-present") {
        if (presentingRef.current) toggleFullscreen();
        else enter();
      } else if (t === "mist-escape" && presentingRef.current) exit();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [enter, exit, toggleFullscreen]);

  // Esc with the focus in the app rather than the deck (after a button click).
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, exit]);

  // The notes window goes with this page.
  useEffect(() => {
    const onHide = () => {
      const s = speakerRef.current;
      if (s && !s.win.closed) s.win.close();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, []);

  const closeCard = useCallback(() => setCardOpen(false), []);
  return useMemo(
    () => ({
      presenting,
      startedAt,
      speakerRoot: speaker?.root ?? null,
      cardOpen,
      fullscreen,
      notesShown: !!speaker || cardOpen,
      enter,
      exit,
      toggleNotes,
      toggleFullscreen,
      closeCard,
    }),
    [presenting, startedAt, speaker, cardOpen, fullscreen, enter, exit, toggleNotes, toggleFullscreen, closeCard],
  );
}
