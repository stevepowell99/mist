import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { BibLibrary } from "~/lib/citations";
import type { DriveMeta } from "~/shared/types";
import { revealPosAtTop } from "~/lib/cm-reveal";
import { buildSlidesHtml, buildSlideSections, deckSlideLayout } from "~/lib/slides-build";
import { deckIndexForOffset, deckSlideTarget, fragmentIndexForOffset, offsetForDeckIndex } from "~/lib/slide-cursor";

export { isSlideDeck } from "~/lib/slides-build";

/** Wait this long after the last edit before rebuilding the deck preview. The
 *  rebuild is now an in-place reveal re-init (tens of ms, no iframe reload), so
 *  this is short: just enough to coalesce a burst of typing into one rebuild.
 *  Ctrl/Cmd+S forces a rebuild immediately. */
const SLIDES_REFRESH_DEBOUNCE_MS = 700;

/**
 * Inline slides renderer for `.qmd` / RevealJS decks. It is the Preview for a
 * deck: when Preview is on and the source is a deck, this renders instead of the
 * document Preview. Presentational, not a Quarto render. The deck HTML is built
 * by the shared buildSlidesHtml and shown with real reveal.js (from a CDN) in a
 * sandboxed iframe. The deck's theme/css come from the document frontmatter.
 *
 * Everything it needs arrives as props rather than out of the room's document
 * context, because the local editor has no room and renders the same decks.
 */
export default function SlidesView({
  markdown,
  drive,
  frontmatter,
  cursorOffset,
  assetToken,
  followCursor,
  bibLib,
  onCommentSlide,
  commentPositions,
  followDeck,
}: {
  markdown: string;
  drive: DriveMeta | null;
  frontmatter: string;
  cursorOffset: number;
  /** Lets the sandboxed iframe fetch private-Drive assets; Drive mode only. */
  assetToken?: string | null;
  followCursor: boolean;
  bibLib: BibLibrary | null;
  /** Offer "Comment on slide" over the deck, for the slide on screen: called
   *  with the source offset of that slide's first line and a label naming it.
   *  Left out in Present, whose own controls carry Comment, and in the local
   *  editor, which cannot take one this way. The button is drawn on this
   *  page, never inside the deck. */
  onCommentSlide?: (slideStart: number, label: string) => void;
  /** Where the document's open comments sit, to count those on the slide on screen. */
  commentPositions?: number[];
  /** The editor to bring to the slide the deck moves to or is clicked on. A
   *  getter rather than the view, because React's dev logging walks object
   *  props (see setIframe). Left out, the deck never moves the editor. */
  followDeck?: () => EditorView | null;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // The session-minted asset token lets the sandboxed iframe fetch private-Drive
  // assets (it cannot send the session cookie).
  const driveToken = drive ? assetToken ?? "" : "";
  // Debounce body edits before refreshing the deck rather than chasing every
  // keystroke. A body change now re-renders the deck in place (postMessage), not
  // a full iframe reload, so this only paces how often we re-parse the markdown.
  const [debounced, setDebounced] = useState(markdown);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(markdown), SLIDES_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [markdown]);

  // Force an immediate refresh (Ctrl/Cmd+S or Ctrl/Cmd+Enter in the editor),
  // skipping the debounce. Flushing the latest markdown into `debounced` drives
  // the in-place render below; no iframe reload.
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  useEffect(() => {
    const rebuild = () => setDebounced(markdownRef.current);
    window.addEventListener("mist-rebuild-deck", rebuild);
    return () => window.removeEventListener("mist-rebuild-deck", rebuild);
  }, []);

  // Cache-bust token, set after mount (avoids an SSR/hydration mismatch).
  const [bust, setBust] = useState("");
  useEffect(() => {
    setBust(Date.now().toString(36)); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Reveal's arrow keys only reach the deck once keyboard focus is inside its
  // iframe, and on open it sits in the app page, so the first arrow did nothing
  // until the slide was clicked. Hand focus to the deck as it loads, unless
  // someone is typing in a visible field (the editor in split view keeps it).
  const focusDeckIfIdle = () => {
    const a = document.activeElement as HTMLElement | null;
    const typing =
      !!a &&
      a !== document.body &&
      (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) &&
      a.getClientRects().length > 0;
    if (!typing) iframeRef.current?.focus();
  };
  /**
   * A callback ref, NOT `ref={iframeRef}`, and this is load-bearing.
   *
   * React 19 passes `ref` through as an ordinary prop, and its dev-mode render
   * logging (on whenever React DevTools is installed) deep-walks prop objects
   * to diff them. Walking a ref object reaches `.current`, the iframe element,
   * and then its `contentWindow` — which is cross-origin here, because the
   * sandbox has no `allow-same-origin`. Reading any property of it throws
   * SecurityError, inside a passive effect, which takes React's work loop down
   * with it ("Should not already be working") and leaves the whole page dead:
   * every button silently does nothing while anchors still work, because they
   * need no handler. That is exactly the "frozen on open from TagFox" report.
   *
   * A function prop is not walked, so the element never becomes reachable.
   * Everything below still uses iframeRef.current as before.
   */
  const setIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);
  // The slide the editor cursor is in, kept in a ref so the in-place render
  // (declared before the cursor logic below) can read the latest value. This is
  // the authoritative target after an edit: derived from the live markdown, so
  // it accounts for slides the edit added or removed.
  const gotoTargetRef = useRef(0);

  // The deck's body, as reveal `<section>` markup. Depends only on the body and
  // the asset context, so an edit changes this without rebuilding the shell.
  const sections = useMemo(
    () => buildSlideSections(debounced, { drive, origin, driveToken, bust, docFrontmatter: frontmatter, bibLib }),
    [debounced, drive, origin, driveToken, bibLib],
  );

  // The iframe only reloads when the shell changes: theme, css links, nav mode
  // (all from the frontmatter), the asset identity, or the cache-bust. A body
  // edit does not, so reveal and its CDN scripts stay loaded across edits.
  const shellSig = useMemo(
    () => JSON.stringify([frontmatter, bust, origin, driveToken, drive]),
    [frontmatter, bust, origin, driveToken, drive],
  );
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  // The sections the current srcDoc embeds, so the in-place effect can tell a
  // fresh reload (already current) from a body-only change (needs a render).
  const embeddedSectionsRef = useRef("");
  const html = useMemo(() => {
    embeddedSectionsRef.current = sectionsRef.current;
    return buildSlidesHtml(debounced, { drive, origin, driveToken, bust, docFrontmatter: frontmatter, bibLib });
    // Rebuild on shell change only; body edits go in place via postMessage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellSig]);

  // In-place render: push new sections into the live iframe when the body
  // changes (but not on a fresh reload, which already carries them).
  useEffect(() => {
    if (sections === embeddedSectionsRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "mist-render", sections, goto: gotoTargetRef.current },
      "*",
    );
  }, [sections]);

  // Cursor-driven sync: as the cursor moves in the editor, jump the deck to the
  // slide it is in, by its deck index (hidden slides not counted). Sent
  // by postMessage because the deck runs in a sandboxed (cross-origin) iframe.
  // Only scan the markdown for the cursor's slide when the follow-cursor sync is
  // on; the scan is O(n) and ran on every cursor move otherwise, which is the
  // main editor lag on a large deck; the layout depends on the text alone, so
  // a cursor move costs a lookup. -1 means "no target" (keep the deck where it
  // is on a rebuild).
  const wantsLayout = followCursor || !!onCommentSlide || !!followDeck;
  const layout = useMemo(() => (wantsLayout ? deckSlideLayout(markdown) : null), [markdown, wantsLayout]);
  const slide = useMemo(
    () => (followCursor && layout ? deckIndexForOffset(markdown, cursorOffset, layout) : -1),
    [markdown, cursorOffset, layout, followCursor],
  );
  const slideRef = useRef(slide);
  slideRef.current = slide;
  gotoTargetRef.current = slide; // latest cursor slide, for the in-place render target
  // The reveal fragment the cursor is in (or -1 for none), so the deck reveals up
  // to the `.fragment` being edited. Kept in a ref for the initial-goto callback.
  const fragment = useMemo(
    () => (followCursor && layout ? fragmentIndexForOffset(markdown, cursorOffset, layout) : -1),
    [markdown, cursorOffset, layout, followCursor],
  );
  const fragmentRef = useRef(fragment);
  fragmentRef.current = fragment;
  const sendGoto = (h: number, f: number) =>
    iframeRef.current?.contentWindow?.postMessage({ type: "mist-goto", h, f }, "*");

  // The deck reports its slide back (cursor-driven or manual nav); mirror it to
  // the URL (?slide=) so a reload restores the same slide. On the first load,
  // restore that slide rather than the cursor's, so the URL wins.
  const initialSlide = useRef<number | null>(null);
  if (initialSlide.current === null && typeof window !== "undefined") {
    const s = new URL(window.location.href).searchParams.get("slide");
    initialSlide.current = s !== null && /^\d+$/.test(s) ? Number(s) : -1; // -1 = none
  }
  // The slide on screen, as the deck last reported it, for the comment button.
  const [onScreen, setOnScreen] = useState(() => Math.max(0, initialSlide.current ?? 0));
  const screenSlide = useMemo(
    () => (onCommentSlide && layout ? deckSlideTarget(markdown, onScreen, layout) : null),
    [onCommentSlide, layout, markdown, onScreen],
  );
  const screenComments = useMemo(
    () => (screenSlide ? (commentPositions ?? []).filter((p) => p >= screenSlide.start && p < screenSlide.end).length : 0),
    [screenSlide, commentPositions],
  );
  const commentOnScreen = () => {
    if (onCommentSlide && screenSlide) onCommentSlide(screenSlide.start, screenSlide.label);
  };

  // Follow the editor cursor. But a deck opened at ?slide=N must STAY there: the
  // cursor sits at offset 0 (slide 0) on load, and a later recompute (content
  // finishing its sync) would otherwise fire this and yank the deck back to
  // slide 0. So when a URL slide was restored, hold the follow until the user
  // actually moves the cursor. Without a URL slide there is nothing to protect.
  const cursorMoved = useRef(false);
  const firstCursor = useRef(true);
  // The cursor offset the deck last put the editor at (followDeckRef below), so
  // the cursor follow does not send that move back to the deck. Echoed, it would
  // hide every fragment of a slide reached by stepping back, and in a burst of
  // steps it could pull the deck back to a slide it had already left. Kept only
  // while the cursor is still there.
  const deckPlaced = useRef<number | null>(null);
  const cursorRef = useRef(cursorOffset);
  cursorRef.current = cursorOffset;
  useEffect(() => {
    if (cursorOffset !== deckPlaced.current) deckPlaced.current = null;
    if (firstCursor.current) {
      firstCursor.current = false;
      return;
    }
    cursorMoved.current = true;
  }, [cursorOffset]);
  useEffect(() => {
    if (!followCursor) return;
    if ((initialSlide.current ?? -1) >= 0 && !cursorMoved.current) return;
    if (deckPlaced.current != null && deckPlaced.current === cursorRef.current) {
      deckPlaced.current = null;
      return;
    }
    sendGoto(slide, fragment);
  }, [slide, fragment, followCursor]);

  // Send the deck the slide it should open on: the URL's ?slide until the
  // cursor first moves (so a shared link restores it), otherwise the cursor's
  // slide. A load asks twice, by mist-need-goto and by the iframe's onLoad; were
  // the restore one-shot, the second ask would send the cursor's slide 0 and
  // snap the deck back to the first slide. Stable (reads refs only), so the
  // handshake listener below can depend on it.
  const sendInitialGoto = useCallback(() => {
    if ((initialSlide.current ?? -1) >= 0 && !cursorMoved.current) sendGoto(initialSlide.current!, -1);
    else sendGoto(slideRef.current, fragmentRef.current);
  }, []);

  // Follow the deck: when it moves to a slide (its keys, a control, the
  // overview) or is clicked, bring the editor to that slide. Never while the
  // editor has focus, because then the cursor is driving the deck and the deck's
  // report of the slide it was sent to must not move the cursor. A cursor
  // already in the slide stays put; a click scrolls it back into view. Ref, so
  // the once-registered listener reads the current text and editor.
  const followDeckRef = useRef<(h: number, click: boolean) => void>(() => {});
  followDeckRef.current = (h, click) => {
    const view = followDeck?.();
    if (!view || view.hasFocus || !layout) return;
    const head = view.state.selection.main.head;
    if (deckIndexForOffset(markdown, head, layout) === h) {
      if (click) view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "nearest" }) });
      return;
    }
    const start = offsetForDeckIndex(markdown, h, layout);
    if (start == null) return; // the References slide has no source
    const pos = Math.min(start, view.state.doc.length);
    deckPlaced.current = pos;
    revealPosAtTop(view, pos);
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number };
      // The deck asks for its opening slide once it is ready (more reliable than
      // pushing on iframe load, whose timing races the iframe's own setup). Take
      // the chance to push the current body too: if it changed while the iframe
      // was booting (content syncing in after a reload), the srcDoc it loaded is
      // stale, and this is what refreshes it without needing manual reloads.
      if (d?.type === "mist-need-goto") {
        focusDeckIfIdle();
        const stale = sectionsRef.current !== embeddedSectionsRef.current;
        if (stale) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "mist-render", sections: sectionsRef.current, goto: gotoTargetRef.current },
            "*",
          );
        }
        sendInitialGoto();
        return;
      }
      const ours = e.source === iframeRef.current?.contentWindow;
      if (d?.type === "mist-deck-click" && typeof d.h === "number") {
        if (ours) followDeckRef.current(d.h, true);
        return;
      }
      // The deck reports its current slide; mirror it to the URL (?slide=).
      if (d?.type !== "mist-slide" || typeof d.h !== "number") return;
      setOnScreen(d.h);
      const url = new URL(window.location.href);
      if (d.h > 0) url.searchParams.set("slide", String(d.h));
      else url.searchParams.delete("slide");
      window.history.replaceState(window.history.state, "", url.toString());
      if (ours) followDeckRef.current(d.h, false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendInitialGoto]);

  // Belt-and-braces: also push the slide on iframe load. The deck reveals on
  // whichever arrives first; both set the same target.
  const onLoad = () => {
    focusDeckIfIdle();
    sendInitialGoto();
  };

  // Jump the deck to a peer's slide when their avatar is clicked (PresenceBar
  // dispatches the slide index on the window).
  useEffect(() => {
    const onJump = (e: Event) => {
      const idx = (e as CustomEvent<number>).detail;
      if (typeof idx === "number") iframeRef.current?.contentWindow?.postMessage({ type: "mist-goto", h: idx, f: -1 }, "*");
    };
    window.addEventListener("mist-goto-slide", onJump);
    return () => window.removeEventListener("mist-goto-slide", onJump);
  }, []);

  // Step the deck as its own arrow keys would, fragments included, for the
  // speaker window's buttons and keys (stepDeck in usePresent).
  useEffect(() => {
    const onStep = (e: Event) => {
      const dir = (e as CustomEvent<string>).detail;
      if (dir === "next" || dir === "prev") iframeRef.current?.contentWindow?.postMessage({ type: "mist-nav", dir }, "*");
    };
    window.addEventListener("mist-deck-nav", onStep);
    return () => window.removeEventListener("mist-deck-nav", onStep);
  }, []);

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={setIframe}
        onLoad={onLoad}
        title="Slides preview"
        sandbox="allow-scripts"
        // allow + allowFullScreen let reveal's F key take the deck fullscreen from
        // inside the sandboxed iframe. Speaker notes are not here: the preview has
        // no navigable deck URL for reveal's notes window, so S is disabled in the
        // embedded runtime and Present's own speaker window shows the notes.
        allow="fullscreen"
        allowFullScreen
        srcDoc={html}
        className="block h-full w-full border-0"
      />
      {/* Over the deck, not in it: the iframe is sandboxed and its runtime is
          shared with Present, /slides and print, which must stay clean. Hidden
          on a slide without source, such as the References slide. */}
      {screenSlide && (
        <button
          type="button"
          onClick={commentOnScreen}
          title="Comment on the slide shown here"
          className="absolute right-2 top-2 z-10 flex cursor-pointer items-center gap-1.5 border border-border bg-paper px-2 py-1 text-xs uppercase tracking-wider text-muted opacity-80 hover:text-ink hover:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Comment on slide
          {screenComments > 0 && (
            <span title={`${screenComments} open comment${screenComments === 1 ? "" : "s"} on this slide`} className="bg-canary px-1 text-[#1a1a1a]">
              {screenComments}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
