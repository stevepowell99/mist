import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { buildSlidesHtml, buildSlideSections } from "~/lib/slides-build";
import { slideIndexForOffset, fragmentIndexForOffset } from "~/lib/slide-cursor";

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
 */
export default function SlidesView() {
  const { markdown, drive, frontmatter, cursorOffset, assetToken, followCursor, bibLib } = useDocument();
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

  const iframeRef = useRef<HTMLIFrameElement>(null);
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
  // slide it is in. The deck's slide split matches `slideIndexForOffset`. Sent
  // by postMessage because the deck runs in a sandboxed (cross-origin) iframe.
  // Only scan the markdown for the cursor's slide when the follow-cursor sync is
  // on; the scan is O(n) and ran on every cursor move otherwise, which is the
  // main editor lag on a large deck. -1 means "no target" (keep the deck where
  // it is on a rebuild).
  const slide = useMemo(
    () => (followCursor ? slideIndexForOffset(markdown, cursorOffset) : -1),
    [markdown, cursorOffset, followCursor],
  );
  const slideRef = useRef(slide);
  slideRef.current = slide;
  gotoTargetRef.current = slide; // latest cursor slide, for the in-place render target
  // The reveal fragment the cursor is in (or -1 for none), so the deck reveals up
  // to the `.fragment` being edited. Kept in a ref for the initial-goto callback.
  const fragment = useMemo(
    () => (followCursor ? fragmentIndexForOffset(markdown, cursorOffset) : -1),
    [markdown, cursorOffset, followCursor],
  );
  const fragmentRef = useRef(fragment);
  fragmentRef.current = fragment;
  const sendGoto = (h: number, f: number) =>
    iframeRef.current?.contentWindow?.postMessage({ type: "mist-goto", h, f }, "*");

  // The deck reports its slide back (cursor-driven or manual nav); mirror it to
  // the URL (?slide=) so a reload restores the same slide. On the first load,
  // restore that slide rather than the cursor's, so the URL wins.
  const initialSlide = useRef<number | null>(null);
  const restored = useRef(false);
  if (initialSlide.current === null && typeof window !== "undefined") {
    const s = new URL(window.location.href).searchParams.get("slide");
    initialSlide.current = s !== null && /^\d+$/.test(s) ? Number(s) : -1; // -1 = none
  }

  // Follow the editor cursor. But a deck opened at ?slide=N must STAY there: the
  // cursor sits at offset 0 (slide 0) on load, and a later recompute (content
  // finishing its sync) would otherwise fire this and yank the deck back to
  // slide 0. So when a URL slide was restored, hold the follow until the user
  // actually moves the cursor. Without a URL slide there is nothing to protect.
  const cursorMoved = useRef(false);
  const firstCursor = useRef(true);
  useEffect(() => {
    if (firstCursor.current) {
      firstCursor.current = false;
      return;
    }
    cursorMoved.current = true;
  }, [cursorOffset]);
  useEffect(() => {
    if (!followCursor) return;
    if ((initialSlide.current ?? -1) >= 0 && !cursorMoved.current) return;
    sendGoto(slide, fragment);
  }, [slide, fragment, followCursor]);

  // Send the deck the slide it should open on: the URL's ?slide on the very
  // first load (so a shared link restores it), otherwise the cursor's slide.
  // Stable (reads refs only), so the handshake listener below can depend on it.
  const sendInitialGoto = useCallback(() => {
    if (!restored.current && initialSlide.current != null && initialSlide.current >= 0) {
      restored.current = true;
      sendGoto(initialSlide.current, -1);
    } else {
      sendGoto(slideRef.current, fragmentRef.current);
    }
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number };
      // The deck asks for its opening slide once it is ready (more reliable than
      // pushing on iframe load, whose timing races the iframe's own setup). Take
      // the chance to push the current body too: if it changed while the iframe
      // was booting (content syncing in after a reload), the srcDoc it loaded is
      // stale, and this is what refreshes it without needing manual reloads.
      if (d?.type === "mist-need-goto") {
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
      // The deck reports its current slide; mirror it to the URL (?slide=).
      if (d?.type !== "mist-slide" || typeof d.h !== "number") return;
      const url = new URL(window.location.href);
      if (d.h > 0) url.searchParams.set("slide", String(d.h));
      else url.searchParams.delete("slide");
      window.history.replaceState(window.history.state, "", url.toString());
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendInitialGoto]);

  // Belt-and-braces: also push the slide on iframe load. The deck reveals on
  // whichever arrives first; both set the same target.
  const onLoad = sendInitialGoto;

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

  return (
    <iframe
      ref={iframeRef}
      onLoad={onLoad}
      title="Slides preview"
      sandbox="allow-scripts"
      // allow + allowFullScreen let reveal's F key take the deck fullscreen from
      // inside the sandboxed iframe; the menu/overview/notes shortcuts work once
      // the iframe has focus (click the slide).
      allow="fullscreen"
      allowFullScreen
      srcDoc={html}
      className="block h-full w-full border-0"
    />
  );
}
