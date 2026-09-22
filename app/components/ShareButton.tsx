import { useState, useCallback } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";
import { isSlideDeck } from "~/components/SlidesView";

/** Build a share URL on the current document, optionally opening in Preview. */
export function shareLink(href: string, key: string | null, asPreview: boolean): string {
  const url = new URL(href);
  const params = new URLSearchParams();
  if (key) params.set("k", key);
  if (asPreview) params.set("view", "preview");
  const qs = params.toString();
  url.search = qs ? `?${qs}` : "";
  return url.toString();
}

/**
 * A deck's standalone viewer link: the same `/slides/:id` page "Print to PDF"
 * already opens, minus `print-pdf`, so it is the full interactive presentation
 * rather than the paginated print layout. Unlike `/docs/:id`, this route is
 * gated by the doc's own secret key alone (`resolveDoc`), with no Google
 * sign-in check, because it never touches per-user Drive ACL. That is what
 * makes it the right link for "shared with anyone with the link": `/docs/:id`
 * always requires a signed-in Google account the file's Drive sharing grants
 * (by design, for editing), so it asks a public viewer to sign in even when
 * the Drive file itself is shared with anyone.
 */
export function deckViewLink(origin: string, docId: string, key: string | null, assetToken: string | null): string {
  const url = new URL(`/slides/${docId}`, origin);
  if (key) url.searchParams.set("k", key);
  if (assetToken) url.searchParams.set("token", assetToken);
  return url.toString();
}

/**
 * A deck's PDF: `/slides/:id/pdf`, printed server-side by headless Chrome and
 * returned as a file, falling back to the browser-print page when it cannot.
 * `combineFragments` puts each slide on one page rather than one per step.
 */
export function deckPdfLink(docId: string, key: string | null, assetToken: string | null, combineFragments = true): string {
  return (
    `/slides/${docId}/pdf?k=${encodeURIComponent(key ?? "")}&token=${encodeURIComponent(assetToken ?? "")}` +
    (combineFragments ? "&combine-fragments" : "")
  );
}

export default function ShareButton() {
  const { docId, markdown, threads, frontmatter, role, docKey, suggestKey, assetToken, drive } = useDocument();
  const [copied, setCopied] = useState<"edit" | "suggest" | null>(null);
  const [copiedView, setCopiedView] = useState(false);
  const [asPreview, setAsPreview] = useState(false);
  const [combineFragments, setCombineFragments] = useState(true);
  const deck = isSlideDeck(markdown, frontmatter);
  const pdfHref = deckPdfLink(docId, docKey, assetToken, combineFragments);

  const handleCopy = useCallback(
    async (kind: "edit" | "suggest", key: string | null) => {
      await navigator.clipboard.writeText(shareLink(window.location.href, key, asPreview));
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    },
    [asPreview],
  );

  // A deck's public link goes to the standalone viewer page, which needs no
  // Google sign-in and cannot edit, unlike /docs/:id (which always checks the
  // file's Drive sharing, since it can drop into the editor). It carries the
  // suggest key, never the edit key, so a link passed around in public cannot
  // be turned back into an edit link.
  const handleCopyView = useCallback(async () => {
    const key = role === "edit" ? suggestKey : docKey;
    await navigator.clipboard.writeText(deckViewLink(window.location.origin, docId, key, assetToken));
    setCopiedView(true);
    setTimeout(() => setCopiedView(false), 2000);
  }, [role, suggestKey, docKey, docId, assetToken]);

  const handleDownload = useCallback(() => {
    const content = serializeThreads(markdown, threads, frontmatter);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [docId, markdown, threads, frontmatter]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          aria-label="Share options"
        >
          Share
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-40 border border-border bg-paper py-1"
          align="end"
          sideOffset={4}
        >
          {deck ? (
            <>
              <DropdownMenu.Item
                onSelect={handleCopyView}
                title="The deck as a slideshow, for anyone with the link: no Google sign-in, and no way to edit"
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                {copiedView ? "✓ Copied" : "Copy public view link"}
              </DropdownMenu.Item>
              <div className="my-1 border-t border-border" />
            </>
          ) : (
            <>
              <DropdownMenu.CheckboxItem
                checked={asPreview}
                onCheckedChange={setAsPreview}
                onSelect={(e) => e.preventDefault()}
                title="The links below open in the app's own preview rather than the editor. Readers still sign in with Google to pass the file's Drive sharing"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center border border-ink">
                  {asPreview ? "✓" : ""}
                </span>
                Links open in preview
              </DropdownMenu.CheckboxItem>
              <div className="my-1 border-t border-border" />
            </>
          )}
          {role === "edit" ? (
            <>
              <DropdownMenu.Item
                onSelect={() => handleCopy("edit", docKey)}
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                {copied === "edit" ? "\u2713 Copied" : "Copy edit link"}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => handleCopy("suggest", suggestKey)}
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                {copied === "suggest" ? "\u2713 Copied" : "Copy suggest link"}
              </DropdownMenu.Item>
            </>
          ) : (
            <DropdownMenu.Item
              onSelect={() => handleCopy("suggest", docKey)}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
            >
              {copied ? "\u2713 Copied" : "Copy link"}
            </DropdownMenu.Item>
          )}
          {drive && (
            <DropdownMenu.Item asChild>
              <a
                href={`https://drive.google.com/file/d/${drive.fileId}/view`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open this file in Google Drive to view or change its real Drive sharing"
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                Open in Google Drive
              </a>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            onSelect={handleDownload}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            Download
          </DropdownMenu.Item>
          {!deck && (
            <DropdownMenu.Item
              onSelect={() => window.dispatchEvent(new CustomEvent("mist-print-doc"))}
              title="Paginate the document into A4 pages and Save as PDF"
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
            >
              Print to PDF
            </DropdownMenu.Item>
          )}
          {deck && (
            <>
              <div className="my-1 border-t border-border" />
              <DropdownMenu.CheckboxItem
                checked={combineFragments}
                onCheckedChange={setCombineFragments}
                onSelect={(e) => e.preventDefault()}
                title="Print one page per slide, with all animation steps revealed, instead of one page per step"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center border border-ink">
                  {combineFragments ? "✓" : ""}
                </span>
                One page per slide
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Item asChild>
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download the deck as a PDF"
                  className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
                >
                  Print to PDF
                </a>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
