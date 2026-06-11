import { useState, useCallback } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";

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

export default function ShareButton() {
  const { docId, markdown, threads, role, docKey, suggestKey } = useDocument();
  const [copied, setCopied] = useState<"edit" | "suggest" | null>(null);
  const [asPreview, setAsPreview] = useState(false);

  const handleCopy = useCallback(
    async (kind: "edit" | "suggest", key: string | null) => {
      await navigator.clipboard.writeText(shareLink(window.location.href, key, asPreview));
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    },
    [asPreview],
  );

  const handleDownload = useCallback(() => {
    const content = serializeThreads(markdown, threads);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [docId, markdown, threads]);

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
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center border border-ink">
              {asPreview ? "✓" : ""}
            </span>
            Open as Preview
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
          <DropdownMenu.Item
            onSelect={handleDownload}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            Download
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
