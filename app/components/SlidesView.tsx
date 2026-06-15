import { useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { buildSlidesHtml } from "~/lib/slides-build";
import { slideIndexForOffset } from "~/lib/slide-cursor";

export { isSlideDeck } from "~/lib/slides-build";

/**
 * Inline slides renderer for `.qmd` / RevealJS decks. It is the Preview for a
 * deck: when Preview is on and the source is a deck, this renders instead of the
 * document Preview. Presentational, not a Quarto render. The deck HTML is built
 * by the shared buildSlidesHtml and shown with real reveal.js (from a CDN) in a
 * sandboxed iframe. The deck's theme/css come from the document frontmatter.
 */
export default function SlidesView() {
  const { markdown, github, drive, frontmatter, cursorOffset, assetToken } = useDocument();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // The session-minted asset token lets the sandboxed iframe fetch private-Drive
  // assets (it cannot send the session cookie).
  const driveToken = drive ? assetToken ?? "" : "";
  // Rebuilding the iframe reloads reveal, so debounce: refresh ~0.8s after edits
  // settle rather than on every keystroke.
  const [debounced, setDebounced] = useState(markdown);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(markdown), 800);
    return () => clearTimeout(t);
  }, [markdown]);

  // Cache-bust token, set after mount (avoids an SSR/hydration mismatch).
  const [bust, setBust] = useState("");
  useEffect(() => {
    setBust(Date.now().toString(36)); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const html = useMemo(
    () => buildSlidesHtml(debounced, { github, drive, origin, driveToken, bust, docFrontmatter: frontmatter }),
    [debounced, github, drive, origin, driveToken, bust, frontmatter],
  );

  // Cursor-driven sync: as the cursor moves in the editor, jump the deck to the
  // slide it is in. The deck's slide split matches `slideIndexForOffset`. Sent
  // by postMessage because the deck runs in a sandboxed (cross-origin) iframe.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const slide = useMemo(() => slideIndexForOffset(markdown, cursorOffset), [markdown, cursorOffset]);
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const sendGoto = (h: number) => iframeRef.current?.contentWindow?.postMessage({ type: "mist-goto", h }, "*");

  // The deck reports its slide back (cursor-driven or manual nav); mirror it to
  // the URL (?slide=) so a reload restores the same slide. On the first load,
  // restore that slide rather than the cursor's, so the URL wins.
  const initialSlide = useRef<number | null>(null);
  const restored = useRef(false);
  if (initialSlide.current === null && typeof window !== "undefined") {
    const s = new URL(window.location.href).searchParams.get("slide");
    initialSlide.current = s !== null && /^\d+$/.test(s) ? Number(s) : -1; // -1 = none
  }

  // On cursor move (no reload). While a URL slide is still waiting to be
  // restored (first load), don't let the initial cursor position (slide 0)
  // pre-empt it.
  useEffect(() => {
    if (!restored.current && (initialSlide.current ?? -1) >= 0) return;
    sendGoto(slide);
  }, [slide]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number };
      if (d?.type !== "mist-slide" || typeof d.h !== "number") return;
      const url = new URL(window.location.href);
      if (d.h > 0) url.searchParams.set("slide", String(d.h));
      else url.searchParams.delete("slide");
      window.history.replaceState(window.history.state, "", url.toString());
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // After a rebuild the iframe reloads and reveal resets to slide 1; re-send the
  // current slide once the new document is ready. The very first load restores
  // the URL's slide if present.
  const onLoad = () => {
    if (!restored.current && initialSlide.current != null && initialSlide.current >= 0) {
      restored.current = true;
      sendGoto(initialSlide.current);
    } else {
      sendGoto(slideRef.current);
    }
  };

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
