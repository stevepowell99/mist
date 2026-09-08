import { useMemo, useEffect, useRef, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { runMermaid } from "~/lib/mermaid";
import { POS_ANCHOR_CSS } from "~/lib/source-anchors";
import { renderDocumentHtml } from "~/lib/render-document";
import { themeCss } from "~/lib/themes";


export default function Preview() {
  const { markdown, drive, bibLib, assetToken, frontmatter } = useDocument();
  const containerRef = useRef<HTMLDivElement>(null);

  // The same theme CSS the deck iframe injects, so a themed document reads the
  // same as a deck. Scoped to :is(.reveal,.preview), so it only touches .preview.
  const themeStyle = useMemo(() => themeCss(frontmatter ?? ""), [frontmatter]);

  // DOMPurify needs a DOM, which the Cloudflare Worker has none of, so the
  // markdown render only runs after hydration. With a Preview share link the
  // page can mount with Preview already showing, hence the client-only gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect

  const html = useMemo(() => {
    if (!mounted) return "";
    // The render chain is one shared function, so this and the plain editor's
    // preview cannot drift apart. See render-document.ts.
    return renderDocumentHtml(markdown, {
      drive,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      driveToken: drive ? assetToken ?? "" : "",
      bibLib,
    });
  }, [mounted, markdown, drive, bibLib, assetToken]);

  // Render any mermaid code blocks into diagrams once the HTML is in the DOM.
  useEffect(() => {
    void runMermaid(containerRef.current);
  }, [html]);

  // React compares the dangerouslySetInnerHTML prop BY REFERENCE, so a fresh
  // `{__html}` object each render made it re-set the innerHTML on every re-render
  // of this component, even when the HTML was identical. That threw away anything
  // written into the DOM afterwards (the mermaid SVGs), while the effect above,
  // keyed on the unchanged html, never ran again to put them back: a diagram
  // rendered, then a stray re-render (a cursor move, a save-status tick) silently
  // turned it back into a code block. Holding the object stable fixes it at the
  // source: the DOM is only rewritten when the HTML really changes.
  const inner = useMemo(() => ({ __html: html }), [html]);

  return (
    <>
      <style>{`${POS_ANCHOR_CSS}\n${themeStyle}`}</style>
      <div ref={containerRef} className="preview font-serif" dangerouslySetInnerHTML={inner} />
    </>
  );
}
