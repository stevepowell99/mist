import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ensureDriveKey, getDriveKey, clearDriveKey } from "~/lib/drive-key";
import { getRecentOpened, addRecentOpened, type RecentItem } from "~/lib/drive-recent";
import type { DriveKind } from "~/lib/google.server";
import type { SearchResult } from "~/routes/drive.search";

/**
 * Reusable Drive search + browse + open panel, with no document dependency, so
 * it serves both the home page and the folder sidebar. Searches all of Drive,
 * browses folders, filters by type, and opens markdown in mist, folders inline,
 * and anything else in a Drive tab. A click that opens or navigates shows a
 * waiter over the page. Gated by the shared Drive passphrase (drive-key.ts).
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

interface Crumb {
  id: string;
  name: string;
}

interface Listing {
  items: Item[];
  /** Folder trail top -> current; last is the current folder. Empty for recent. */
  trail: Crumb[];
  isSearch: boolean;
}

const TYPES: { kind: DriveKind; label: string }[] = [
  { kind: "markdown", label: "Markdown" },
  { kind: "folder", label: "Folders" },
  { kind: "doc", label: "Docs" },
  { kind: "sheet", label: "Sheets" },
  { kind: "slides", label: "Slides" },
  { kind: "pdf", label: "PDF" },
];

export function KindIcon({ kind }: { kind: DriveKind }) {
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

export function Spinner() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin" aria-label="Loading">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function DriveBrowser({
  startFolderId = null,
  currentFileId = null,
  className = "",
}: {
  startFolderId?: string | null;
  currentFileId?: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<DriveKind[]>(["markdown", "folder"]);
  const [folderRef, setFolderRef] = useState<string | null>(startFolderId);
  const [data, setData] = useState<Listing | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0); // guards against out-of-order responses racing

  // Recently-opened files (localStorage) for an instant list on open and a
  // pinned quick-access section at the bottom. Read after mount (no SSR).
  useEffect(() => {
    setRecent(getRecentOpened());
  }, []);

  const refresh = useCallback(async () => {
    const key = ensureDriveKey();
    if (!key) return;
    const mine = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (types.length) p.set("types", types.join(","));
      const q = query.trim();
      if (q) p.set("q", q);
      else if (folderRef) p.set("folder", folderRef);
      const res = await fetch(`/drive/search?${p.toString()}`, { headers: { "X-Drive-Key": key } });
      if (res.status === 401) {
        clearDriveKey();
        throw new Error("wrong passphrase, try again");
      }
      const body = (await res.json()) as {
        results?: SearchResult[];
        folder?: { trail: Crumb[] } | null;
        error?: string;
      };
      if (mine !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body.error ?? "load failed");
      const items: Item[] = (body.results ?? []).map((r) => ({ ...r, isFolder: r.kind === "folder" }));
      setData({ items, trail: q ? [] : body.folder?.trail ?? [], isSearch: !!q });
    } catch (e) {
      if (mine === reqId.current) setError(e instanceof Error ? e.message : "could not load");
    } finally {
      if (mine === reqId.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [folderRef, query, types]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const toggleType = useCallback((kind: DriveKind) => {
    setTypes((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }, []);

  const browseFolder = useCallback((id: string) => {
    setBusy(true);
    setQuery("");
    setFolderRef(id);
  }, []);

  const openFile = useCallback(
    async (item: RecentItem) => {
      setBusy(true);
      setError(null);
      try {
        const key = getDriveKey();
        const res = await fetch("/drive/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(key ? { "X-Drive-Key": key } : {}) },
          body: JSON.stringify({ url: item.id }),
        });
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong passphrase, try again");
        }
        const body = (await res.json()) as { url?: string; error?: string };
        if (body.url) {
          addRecentOpened({ id: item.id, name: item.name, path: item.path });
          // Client-side navigation keeps the top bar mounted through the load;
          // the doc page remounts per id (keyed) so Yjs state resets.
          navigate(body.url);
          return; // keep the waiter up until the route swaps
        }
        throw new Error(body.error ?? "could not open file");
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open file");
        setBusy(false);
      }
    },
    [navigate],
  );

  const onPick = useCallback(
    (item: Item) => {
      if (item.isFolder) browseFolder(item.id);
      else if (item.openInMist) void openFile({ id: item.id, name: item.name, path: item.path });
      else if (item.webViewLink) window.open(item.webViewLink, "_blank", "noopener,noreferrer");
    },
    [browseFolder, openFile],
  );

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {busy && (
        <div className="fixed inset-x-0 bottom-0 top-[var(--header-h,0px)] z-[60] flex items-center justify-center bg-paper/70 text-ink">
          <Spinner />
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all of Drive"
        className="border-b border-border bg-transparent px-3 py-2 text-sm outline-none"
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
              className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors ${
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
      {data && !data.isSearch && (
        <div className="border-b border-border px-3 py-1">
          {data.trail.length > 1 && (
            <div className="truncate text-xs opacity-50">
              {data.trail.slice(0, -1).map((c, i) => (
                <span key={c.id}>
                  {i > 0 && <span className="opacity-60"> / </span>}
                  <button
                    type="button"
                    onClick={() => browseFolder(c.id)}
                    className="cursor-pointer hover:underline"
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="truncate text-sm font-medium">
            {data.trail[data.trail.length - 1]?.name ?? "Recent"}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-3 py-2 text-sm opacity-70">Loading…</p>}
        {error && <p className="px-3 py-2 text-sm text-coral">{error}</p>}
        {data && !loading && (
          <ul className="text-sm">
            {data.items.map((e) => {
              const isCurrent = e.id === currentFileId;
              const cursor = e.isFolder || e.openInMist ? "cursor-pointer" : "cursor-alias";
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(e)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-black/5 disabled:opacity-50 ${cursor} ${isCurrent ? "font-semibold" : ""}`}
                    title={e.isFolder ? "Open folder" : e.openInMist ? "Open in mist" : "Open in Drive (new tab)"}
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
            {data.items.length === 0 && <li className="px-3 py-2 text-sm opacity-70">Nothing here.</li>}
          </ul>
        )}
      </div>
      {recent.length > 0 && (
        <div className="shrink-0 border-t border-border">
          <div className="px-3 py-1 text-xs uppercase tracking-wide opacity-50">Recently opened</div>
          <ul className="max-h-44 overflow-y-auto text-sm">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openFile(r)}
                  className="flex w-full cursor-pointer items-start gap-2 px-3 py-1 text-left hover:bg-black/5 disabled:opacity-50"
                  title="Open in mist"
                >
                  <span className="mt-0.5 shrink-0">
                    <KindIcon kind="markdown" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {r.path && <span className="block truncate text-xs opacity-50">{r.path}</span>}
                    <span className="block truncate">{r.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
