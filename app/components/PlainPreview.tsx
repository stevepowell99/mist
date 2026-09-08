import { useEffect, useMemo, useRef } from "react";
import { renderDocumentHtml } from "~/lib/render-document";
import { runMermaid } from "~/lib/mermaid";
import { POS_ANCHOR_CSS } from "~/lib/source-anchors";
import { themeCss } from "~/lib/themes";
import { rawFrontmatter } from "~/lib/thread-serialization";
import type { BibLibrary } from "~/lib/citations";
import type { DriveMeta } from "~/shared/types";

/**
 * The rendered document, beside the plain editor.
 *
 * It reads the same string the editor holds rather than a second copy of it, and
 * it renders through the one shared chain, so nothing here can drift from the
 * Drive-side preview.
 */
export default function PlainPreview({
  markdown,
  drive,
  bibLib,
}: {
  markdown: string;
  drive: DriveMeta | null;
  bibLib: BibLibrary | null;
}) {
  const container = useRef<HTMLDivElement>(null);

  const themeStyle = useMemo(() => themeCss(rawFrontmatter(markdown)), [markdown]);

  const html = useMemo(
    () =>
      renderDocumentHtml(markdown, {
        drive,
        origin: typeof window !== "undefined" ? window.location.origin : "",
        driveToken: "",
        bibLib,
      }),
    [markdown, drive, bibLib],
  );

  useEffect(() => {
    void runMermaid(container.current);
  }, [html]);

  // React compares dangerouslySetInnerHTML by reference, so a fresh object every
  // render would re-set the DOM and throw away the mermaid SVGs written into it
  // afterwards. Hold it stable: the DOM is rewritten only when the HTML changes.
  const inner = useMemo(() => ({ __html: html }), [html]);

  return (
    <div className="h-full overflow-auto px-6 py-4">
      <style>{`${POS_ANCHOR_CSS}\n${themeStyle}`}</style>
      <div ref={container} className="preview font-serif" dangerouslySetInnerHTML={inner} />
    </div>
  );
}
