import { useEffect, useMemo, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { buildSlidesHtml } from "~/lib/slides-build";
import { getDriveKey } from "~/lib/drive-key";

export { isSlideDeck } from "~/lib/slides-build";

/**
 * Inline slides renderer for `.qmd` / RevealJS decks. It is the Preview for a
 * deck: when Preview is on and the source is a deck, this renders instead of the
 * document Preview. Presentational, not a Quarto render. The deck HTML is built
 * by the shared buildSlidesHtml and shown with real reveal.js (from a CDN) in a
 * sandboxed iframe. The deck's theme/css come from the document frontmatter.
 */
export default function SlidesView() {
  const { markdown, github, drive, frontmatter } = useDocument();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const driveToken = drive ? getDriveKey() ?? "" : "";
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

  return (
    <iframe
      title="Slides preview"
      sandbox="allow-scripts"
      srcDoc={html}
      className="block h-full w-full border-0"
    />
  );
}
