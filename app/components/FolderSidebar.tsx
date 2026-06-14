import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { ensureDriveKey, getDriveKey, clearDriveKey } from "~/lib/drive-key";

interface Entry {
  name: string;
  isFolder: boolean;
  ref: string;
}

interface Listing {
  entries: Entry[];
  folderRef: string | null;
  parentRef: string | null;
  currentPath: string | null;
  folderName: string | null;
}

function FolderGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

function folderLabel(ref: string | null | undefined): string {
  if (!ref) return "Folder";
  return ref.split("/").pop() || "Folder";
}

/**
 * Slide-out folder navigator for a folder-backed document. The trigger sits in
 * the header; the panel is a fixed overlay so it works on mobile and desktop.
 * Renders only when the document has a folder backend (GitHub today, Drive later).
 */
export default function FolderSidebar() {
  const { github, drive, docId, docKey } = useDocument();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(
    async (ref: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (docKey) params.set("k", docKey);
        if (ref != null) params.set("ref", ref);
        // The Drive folder listing browses the relay's Drive, so it needs the
        // shared passphrase too; GitHub listing is public and needs no header.
        const headers: HeadersInit = {};
        if (drive) {
          const key = ensureDriveKey();
          if (key) headers["X-Drive-Key"] = key;
        }
        const res = await fetch(`/docs/${docId}/folder?${params.toString()}`, { headers });
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong Drive passphrase, try again");
        }
        if (!res.ok) throw new Error(`could not load folder (${res.status})`);
        setData((await res.json()) as Listing);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load folder");
      } finally {
        setLoading(false);
      }
    },
    [docId, docKey, drive],
  );

  useEffect(() => {
    if (open && !data && !loading) void load(null);
  }, [open, data, loading, load]);

  const openFile = useCallback(
    async (ref: string) => {
      if (opening) return;
      setOpening(true);
      setError(null);
      try {
        let res: Response;
        if (drive) {
          const key = getDriveKey();
          res = await fetch("/drive/import", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { "X-Drive-Key": key } : {}) },
            body: JSON.stringify({ url: ref }),
          });
        } else if (github) {
          const encPath = ref.split("/").map(encodeURIComponent).join("/");
          const blobUrl = `https://github.com/${github.owner}/${github.repo}/blob/${github.branch}/${encPath}`;
          res = await fetch("/gh/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: blobUrl }),
          });
        } else {
          return;
        }
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong Drive passphrase, try again");
        }
        const body = (await res.json()) as { url?: string; error?: string };
        if (body.url) {
          window.location.href = body.url;
          return;
        }
        setError(body.error ?? "could not open file");
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open file");
      }
      setOpening(false);
    },
    [github, drive, opening],
  );

  if (!github && !drive) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Folder"
        aria-label="Folder"
        className="flex shrink-0 items-center border-r border-border px-3 transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <FolderGlyph />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close folder"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/30"
          />
          <div className="fixed left-0 top-0 z-50 flex h-screen w-80 max-w-[85vw] flex-col border-r border-border bg-paper shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="truncate font-medium" title={data?.folderRef ?? undefined}>
                {data?.folderName || folderLabel(data?.folderRef)}
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="px-2 text-lg leading-none">
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && <p className="px-4 py-2 text-sm opacity-70">Loading…</p>}
              {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
              {data && !loading && (
                <ul className="text-sm">
                  {data.parentRef !== null && (
                    <li>
                      <button
                        type="button"
                        onClick={() => void load(data.parentRef)}
                        className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-black/5"
                      >
                        <FolderGlyph />
                        <span className="opacity-70">..</span>
                      </button>
                    </li>
                  )}
                  {data.entries.map((e) => {
                    const isCurrent = e.ref === data.currentPath;
                    return (
                      <li key={e.ref}>
                        <button
                          type="button"
                          disabled={opening}
                          onClick={() => (e.isFolder ? void load(e.ref) : void openFile(e.ref))}
                          className={`flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-black/5 disabled:opacity-50 ${isCurrent ? "font-semibold" : ""}`}
                        >
                          {e.isFolder ? <FolderGlyph /> : <FileGlyph />}
                          <span className="truncate">{e.name}</span>
                        </button>
                      </li>
                    );
                  })}
                  {data.entries.length === 0 && (
                    <li className="px-4 py-2 text-sm opacity-70">No markdown files here.</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
