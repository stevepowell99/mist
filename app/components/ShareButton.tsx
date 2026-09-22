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
  const [asPreview, setAsPreview] = useState(false);
  const [combineFragments, setCombineFragments] = useState(true);
  const deck = isSlideDeck(markdown, frontmatter);
  const pdfHref = deckPdfLink(docId, docKey, assetToken, combineFragments);

  const handleCopy = useCallback(
    async (kind: "edit" | "suggest", key: string | null) => {
      // A deck's preview link goes straight to the standalone viewer page
      // (no Google sign-in) rather than /docs/:id?view=preview (which always
      // needs one, since that route also has to check Drive's per-user ACL
      // for the editor it can drop into). A share meant only for viewing
      // should not ask a reader who is not signing in to edit anything to
      // sign in at all.
      const url =
        deck && asPreview
          ? deckViewLink(window.location.origin, docId, key, assetToken)
          : shareLink(window.location.href, key, asPreview);
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    },
    [asPreview, deck, docId, assetToken],
  );

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
          <DropdownMenu.CheckboxItem
            checked={asPreview}
            onCheckedChange={setAsPreview}
            onSelect={(e) => e.preventDefault()}
            title={
              deck
                ? "For a deck this is the standalone viewer link: no Google sign-in, matching a Drive share of anyone with the link"
                : "Opens read-only in the app's own preview, which still needs Google sign-in for a Drive-bound document"
            }
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center border border-ink">
              {asPreview ? "✓" : ""}
            </span>
            {deck ? "Open link as preview (no sign-in)" : "Open link as preview"}
          </DropdownMenu.CheckboxItem>
          <div className="my-1 border-t border-border" />
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
