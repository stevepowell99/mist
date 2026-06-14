import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { ensureDriveKey, getDriveKey, clearDriveKey } from "~/lib/drive-key";
import type { DriveKind } from "~/lib/google.server";
import type { SearchResult } from "~/routes/drive.search";

/**
 * One panel for both searching and browsing the backend folder, and opening
 * files. For Drive it searches/browses via /drive/search (type filter, recent
 * default, breadcrumb paths) and opens markdown in mist, folders inline, and
 * anything else in a Drive tab. For GitHub it browses via /docs/:id/folder.
 * A click that opens or navigates shows a waiter over the main pane.
 */

interface Item {
  id: string;
  name: string;
  isFolder: boolean;
  openInMist: boolean;
  webViewLink: string | null;
  kind: DriveKind;
  path?: string;
}

interface Listing {
  items: Item[];
  parentRef: string | null;
  folderName: string;
  isSearch: boolean;
  currentPath: string | null;
}

const TYPES: { kind: DriveKind; label: string }[] = [
  { kind: "markdown", label: "Markdown" },
  { kind: "folder", label: "Folders" },
  { kind: "doc", label: "Docs" },
  { kind: "sheet", label: "Sheets" },
  { kind: "slides", label: "Slides" },
  { kind: "pdf", label: "PDF" },
];

function KindIcon({ kind }: { kind: DriveKind }) {
  const p = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "folder":
      return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "doc":
      return <svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h8M8 9h2" /></svg>;
    case "sheet":
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>;
    case "slides":
      return <svg {...p}><rect x="3" y="4" width="18" height="13" rx="1" /><path d="M12 17v3M8 20h8" /></svg>;
    default:
      return <svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 17v-4l2 2 2-2v4" /></svg>;
  }
}

function Spinner() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin" aria-label="Loading">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function FolderSidebar() {
  const { github, drive, docId, docKey } = useDocument();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<DriveKind[]>(["markdown", "folder"]);
  const [folderRef, setFolderRef] = useState<string | null>(null);
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // a click is opening/navigating: show the waiter

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (drive) {
        const key = ensureDriveKey();
        if (!key) {
          setLoading(false);
          return;
        }
        const p = new URLSearchParams();
        if (types.length) p.set("types", types.join(","));
        const q = query.trim();
        const fid = folderRef ?? drive.folderId ?? null;
        if (q) p.set("q", q);
        else if (fid) p.set("folder", fid);
        const res = await fetch(`/drive/search?${p.toString()}`, { headers: { "X-Drive-Key": key } });
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong passphrase, try again");
        }
        const body = (await res.json()) as {
          results?: SearchResult[];
          folder?: { name: string; parent: string | null } | null;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "load failed");
        const items: Item[] = (body.results ?? []).map((r) => ({ ...r, isFolder: r.kind === "folder" }));
        setData({
          items,
          parentRef: q ? null : body.folder?.parent ?? null,
          folderName: q ? `Results for "${q}"` : body.folder?.name ?? "Recent",
          isSearch: !!q,
          currentPath: drive.fileId,
        });
      } else if (github) {
        const p = new URLSearchParams();
        if (docKey) p.set("k", docKey);
        if (folderRef != null) p.set("ref", folderRef);
        const res = await fetch(`/docs/${docId}/folder?${p.toString()}`);
        if (!res.ok) throw new Error(`could not load folder (${res.status})`);
        const body = (await res.json()) as {
          entries: { name: string; isFolder: boolean; ref: string }[];
          parentRef: string | null;
          currentPath: string | null;
          folderName: string | null;
        };
        const items: Item[] = body.entries.map((e) => ({
          id: e.ref,
          name: e.name,
          isFolder: e.isFolder,
          openInMist: !e.isFolder,
          webViewLink: null,
          kind: e.isFolder ? "folder" : "markdown",
        }));
        setData({
          items,
          parentRef: body.parentRef,
          folderName: body.folderName ?? "Folder",
          isSearch: false,
          currentPath: body.currentPath,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load");
    } finally {
      setLoading(false);
      setBusy(false); // a folder navigation finished; file opens navigate away first
    }
  }, [drive, github, docId, docKey, folderRef, query, types]);

  // Load on open and whenever the folder, query or filter changes (debounced).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(t);
  }, [open, refresh]);

  const toggleType = useCallback((kind: DriveKind) => {
    setTypes((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }, []);

  const browseFolder = useCallback((id: string) => {
    setBusy(true);
    setQuery("");
    setFolderRef(id);
  }, []);

  const openFile = useCallback(
    async (item: Item) => {
      setBusy(true);
      setError(null);
      try {
        let res: Response;
        if (drive) {
          const key = getDriveKey();
          res = await fetch("/drive/import", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { "X-Drive-Key": key } : {}) },
            body: JSON.stringify({ url: item.id }),
          });
        } else if (github) {
          const encPath = item.id.split("/").map(encodeURIComponent).join("/");
          const blobUrl = `https://github.com/${github.owner}/${github.repo}/blob/${github.branch}/${encPath}`;
          res = await fetch("/gh/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: blobUrl }),
          });
        } else {
          setBusy(false);
          return;
        }
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong passphrase, try again");
        }
        const body = (await res.json()) as { url?: string; error?: string };
        if (body.url) {
          window.location.href = body.url; // full load so the doc/Yjs state resets
          return; // keep the waiter up until the page unloads
        }
        throw new Error(body.error ?? "could not open file");
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open file");
        setBusy(false);
      }
    },
    [drive, github],
  );

  const onPick = useCallback(
    (item: Item) => {
      if (item.isFolder) browseFolder(item.id);
      else if (item.openInMist) void openFile(item);
      else if (item.webViewLink) window.open(item.webViewLink, "_blank", "noopener,noreferrer");
    },
    [browseFolder, openFile],
  );

  if (!github && !drive) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Open from Drive"
        aria-label="Open from Drive"
        className="flex shrink-0 items-center border-r border-border px-3 transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-paper/70 text-ink">
          <Spinner />
        </div>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label="Close folder"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/30"
          />
          <div className="fixed left-0 top-0 z-50 flex h-screen w-96 max-w-[90vw] flex-col border-r border-border bg-paper shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="truncate font-medium" title={data?.folderName ?? undefined}>
                {data?.folderName ?? "Drive"}
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="px-2 text-lg leading-none">
                &times;
              </button>
            </div>

            {drive && (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all of Drive"
                  className="border-b border-border bg-transparent px-4 py-2 text-sm outline-none"
                  aria-label="Search Drive"
                />
                <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
                  {TYPES.map((t) => {
                    const on = types.includes(t.kind);
                    return (
                      <button
                        key={t.kind}
                        type="button"
                        onClick={() => toggleType(t.kind)}
                        aria-pressed={on}
                        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors ${
                          on ? "border-ink bg-ink text-paper" : "border-border text-muted hover:border-ink"
                        }`}
                        title={t.label}
                      >
                        <KindIcon kind={t.kind} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading && <p className="px-4 py-2 text-sm opacity-70">Loading…</p>}
              {error && <p className="px-4 py-2 text-sm text-coral">{error}</p>}
              {data && !loading && (
                <ul className="text-sm">
                  {!data.isSearch && data.parentRef !== null && (
                    <li>
                      <button
                        type="button"
                        onClick={() => browseFolder(data.parentRef as string)}
                        className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-black/5"
                      >
                        <KindIcon kind="folder" />
                        <span className="opacity-70">..</span>
                      </button>
                    </li>
                  )}
                  {data.items.map((e) => {
                    const isCurrent = e.id === data.currentPath;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onPick(e)}
                          className={`flex w-full items-start gap-2 px-4 py-1.5 text-left hover:bg-black/5 disabled:opacity-50 ${isCurrent ? "font-semibold" : ""}`}
                          title={e.isFolder ? "Open folder" : e.openInMist ? "Open in mist" : "Open in Drive"}
                        >
                          <span className="mt-0.5 shrink-0">
                            <KindIcon kind={e.kind} />
                          </span>
                          <span className="min-w-0 flex-1">
                            {data.isSearch && e.path && (
                              <span className="block truncate text-xs opacity-50">{e.path}</span>
                            )}
                            <span className="block truncate">{e.name}</span>
                          </span>
                          {!e.openInMist && !e.isFolder && (
                            <span className="mt-0.5 shrink-0 text-xs opacity-50">Drive</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {data.items.length === 0 && (
                    <li className="px-4 py-2 text-sm opacity-70">Nothing here.</li>
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
