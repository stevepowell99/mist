import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getRecentOpened, addRecentOpened, type RecentItem } from "~/lib/drive-recent";
import type { DriveKind } from "~/lib/google.server";
import type { SearchResult } from "~/routes/drive.search";

/**
 * Reusable Drive search + browse + open panel, with no document dependency, so
 * it serves both the home page and the folder sidebar. Searches all of Drive,
 * browses folders, filters by type, and opens markdown in mist, folders inline,
 * and anything else in a Drive tab. A click that opens or navigates shows a
 * waiter over the page. Access is by Google sign-in plus the file's own Drive
 * sharing; a 401 means the session has lapsed.
 */

const SIGN_IN_MSG = "Sign in with Google on the home page to use Drive.";

/** Parse a JSON response, but if the body is not JSON (e.g. a sanitised server
 *  error page), surface the text as a clean error instead of a parse crash. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(text.trim().slice(0, 200) || `request failed (${res.status})`);
  }
}

interface Item {
  id: string;
  name: string;
  isFolder: boolean;
  openInMist: boolean;
  webViewLink: string | null;
  kind: DriveKind;
  path?: string;
  parentId?: string | null;
  trail?: { id: string; name: string }[];
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

/** localStorage key for the persisted recent-list divider height. */
const RECENT_HEIGHT_KEY = "mistDriveRecentHeight";

const gprops = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const PencilGlyph = () => <svg {...gprops}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const CopyGlyph = () => <svg {...gprops}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
const LinkGlyph = () => <svg {...gprops}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
const TrashGlyph = () => <svg {...gprops}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>;

function RowAction({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="cursor-pointer rounded p-1 text-muted hover:bg-black/10 hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A file's parent-folder path, shown above its name. Each folder segment is its
 *  own link that browses into THAT folder (like the browse trail), so you can jump
 *  to any ancestor, not just the immediate parent. Older recents saved before the
 *  trail existed fall back to plain text. Shared by the search list and the
 *  Recently-opened list so both read and behave the same. */
function PathCrumb({ trail, path, onGo }: { trail?: { id: string; name: string }[]; path?: string; onGo: (id: string) => void }) {
  if (trail && trail.length) {
    return (
      <span className="block truncate text-xs">
        {trail.map((c, i) => (
          <span key={c.id}>
            {i > 0 && <span className="opacity-40"> / </span>}
            <span
              role="button"
              tabIndex={0}
              onClick={(ev) => {
                ev.stopPropagation();
                onGo(c.id);
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.stopPropagation();
                  onGo(c.id);
                }
              }}
              title={`Go to ${c.name}`}
              className="cursor-pointer opacity-50 hover:underline hover:opacity-100"
            >
              {c.name}
            </span>
          </span>
        ))}
      </span>
    );
  }
  if (path) return <span className="block truncate text-xs opacity-50">{path}</span>;
  return null;
}

/** In-memory cache of folder listings (NOT searches), keyed by folder + types, so
 *  reopening the browser or moving between docs shows the last contents at once
 *  instead of a Loading flash, then refreshes silently. Lives for the page session. */
const listingCache = new Map<string, Listing>();
const cacheKey = (folder: string | null, types: DriveKind[]) => `${folder ?? "recent"}|${[...types].sort().join(",")}`;

export default function DriveBrowser({
  startFolderId = null,
  currentFileId = null,
  className = "",
  active = false,
}: {
  startFolderId?: string | null;
  currentFileId?: string | null;
  className?: string;
  /** True while the containing panel is open: focus the search box on each open. */
  active?: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<DriveKind[]>(["markdown", "folder"]);
  const [folderRef, setFolderRef] = useState<string | null>(startFolderId);
  // Seed from the cache so a remount (e.g. opening another doc's sidebar at the
  // same folder) paints the last contents immediately. Default types match the
  // `types` initial state below.
  const [data, setData] = useState<Listing | null>(() => listingCache.get(cacheKey(startFolderId, ["markdown", "folder"])) ?? null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Persist the recent-list height so the divider position survives reloads. The
  // recent section only renders client-side (after the localStorage read below),
  // so reading the stored height in the initialiser causes no SSR mismatch.
  const [recentHeight, setRecentHeight] = useState(() => {
    if (typeof window === "undefined") return 180;
    const v = Number(window.localStorage.getItem(RECENT_HEIGHT_KEY));
    return Number.isFinite(v) && v >= 40 ? v : 180;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0); // guards against out-of-order responses racing

  // Focus the search box whenever the containing panel opens, so the viewer can
  // type straight away. The panel stays mounted between opens (so it can show
  // cached contents instantly), hence keying on `active` rather than mount.
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  // Drag the divider above the recent list to resize it against the list above;
  // store the final height on release.
  const startRecentDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    let last = rect.bottom; // overwritten on first move
    const onMove = (ev: MouseEvent) => {
      last = Math.max(40, Math.min(rect.height - 140, rect.bottom - ev.clientY));
      setRecentHeight(last);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem(RECENT_HEIGHT_KEY, String(Math.round(last)));
      } catch {
        // storage may be unavailable (private mode); the size still applies live
      }
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Recently-opened files (localStorage) for an instant list on open and a
  // pinned quick-access section at the bottom. Read after mount (no SSR).
  useEffect(() => {
    setRecent(getRecentOpened());
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++reqId.current;
    const q = query.trim();
    // Folder listings are cached by folder+types: show the cached copy at once
    // and refresh silently (no spinner), so reopening never flashes Loading.
    // Searches are volatile, so they always show the spinner and are not cached.
    const key = q ? null : cacheKey(folderRef, types);
    const cached = key ? listingCache.get(key) : undefined;
    if (cached) setData(cached);
    setError(null);
    setLoading(!cached);
    try {
      const p = new URLSearchParams();
      if (types.length) p.set("types", types.join(","));
      if (q) p.set("q", q);
      else if (folderRef) p.set("folder", folderRef);
      const res = await fetch(`/drive/search?${p.toString()}`);
      if (res.status === 401) throw new Error(SIGN_IN_MSG);
      const body = (await readJson(res)) as {
        results?: SearchResult[];
        folder?: { trail: Crumb[] } | null;
        error?: string;
      };
      if (mine !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body.error ?? "load failed");
      const items: Item[] = (body.results ?? []).map((r) => ({ ...r, isFolder: r.kind === "folder" }));
      const listing: Listing = { items, trail: q ? [] : body.folder?.trail ?? [], isSearch: !!q };
      setData(listing);
      if (key) listingCache.set(key, listing);
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
        const res = await fetch("/drive/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.id }),
        });
        if (res.status === 401) throw new Error(SIGN_IN_MSG);
        const body = (await readJson(res)) as { url?: string; error?: string };
        if (body.url) {
          addRecentOpened({ id: item.id, name: item.name, path: item.path, parentId: item.parentId, trail: item.trail });
          // Carry the current View (editor/split/preview) onto the new doc so
          // the layout is preserved when opening from the sidebar.
          const view = typeof window !== "undefined"
            ? new URL(window.location.href).searchParams.get("view")
            : null;
          const target = view ? `${body.url}&view=${encodeURIComponent(view)}` : body.url;
          // Client-side navigation keeps the top bar mounted through the load;
          // the doc page remounts per id (keyed) so Yjs state resets.
          navigate(target);
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
      else if (item.openInMist) void openFile({ id: item.id, name: item.name, path: item.path, parentId: item.parentId, trail: item.trail });
      else if (item.webViewLink) window.open(item.webViewLink, "_blank", "noopener,noreferrer");
    },
    [browseFolder, openFile],
  );

  // File operations (create / rename / duplicate / trash) via /drive/op.
  const driveOp = useCallback(
    async (payload: Record<string, unknown>): Promise<{ file?: { id: string; name: string } }> => {
      const res = await fetch("/drive/op", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) throw new Error(SIGN_IN_MSG);
      const body = (await readJson(res)) as { file?: { id: string; name: string }; error?: string };
      if (!res.ok) throw new Error(body.error ?? "operation failed");
      return body;
    },
    [],
  );

  const newFile = useCallback(
    async (folderId: string) => {
      const name = typeof window !== "undefined" ? window.prompt("New file name", "untitled.md") : null;
      if (!name) return;
      setBusy(true);
      setError(null);
      try {
        const r = await driveOp({ action: "create", folderId, name });
        if (r.file) {
          await openFile({ id: r.file.id, name: r.file.name });
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not create");
      }
      setBusy(false);
    },
    [driveOp, openFile],
  );

  const renameItem = useCallback(
    async (item: Item) => {
      const name = window.prompt("Rename to", item.name);
      if (!name || name === item.name) return;
      setBusy(true);
      setError(null);
      try {
        await driveOp({ action: "rename", fileId: item.id, name });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not rename");
        setBusy(false);
      }
    },
    [driveOp, refresh],
  );

  const duplicateItem = useCallback(
    async (item: Item) => {
      setBusy(true);
      setError(null);
      try {
        await driveOp({ action: "duplicate", fileId: item.id });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not duplicate");
        setBusy(false);
      }
    },
    [driveOp, refresh],
  );

  const trashItem = useCallback(
    async (item: Item) => {
      if (!window.confirm(`Move "${item.name}" to Drive trash? (recoverable)`)) return;
      setBusy(true);
      setError(null);
      try {
        await driveOp({ action: "trash", fileId: item.id });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not trash");
        setBusy(false);
      }
    },
    [driveOp, refresh],
  );

  const copyPath = useCallback((item: Item) => {
    const p = (item.path ? `${item.path} / ` : "") + item.name;
    void navigator.clipboard?.writeText(p);
  }, []);

  const currentFolderId = data && !data.isSearch ? data.trail[data.trail.length - 1]?.id ?? null : null;

  return (
    <div ref={rootRef} className={`flex min-h-0 flex-col ${className}`}>
      {busy && (
        <div className="fixed inset-x-0 bottom-0 top-[var(--header-h,0px)] z-[60] flex items-center justify-center bg-paper/70 text-ink">
          <Spinner />
        </div>
      )}
      <input
        ref={inputRef}
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
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {data.trail[data.trail.length - 1]?.name ?? "Recent in Drive"}
            </span>
            {currentFolderId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void newFile(currentFolderId)}
                title="New markdown file in this folder"
                className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              >
                + New
              </button>
            )}
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
                <li key={e.id} className="group flex items-stretch hover:bg-black/5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(e)}
                    className={`flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left disabled:opacity-50 ${cursor} ${isCurrent ? "font-semibold" : ""}`}
                    title={e.isFolder ? "Open folder" : e.openInMist ? "Open in gmist" : "Open in Drive (new tab)"}
                  >
                    <span className="mt-0.5 shrink-0">
                      <KindIcon kind={e.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {data.isSearch && <PathCrumb trail={e.trail} path={e.path} onGo={browseFolder} />}
                      <span className="block truncate">{e.name}</span>
                    </span>
                    {!e.openInMist && !e.isFolder && (
                      <span className="mt-0.5 shrink-0 text-xs opacity-50">Drive</span>
                    )}
                  </button>
                  <div className="hidden shrink-0 items-center gap-0.5 pr-1.5 group-hover:flex">
                    {!e.isFolder && (
                      <RowAction title="Duplicate" disabled={busy} onClick={() => void duplicateItem(e)}>
                        <CopyGlyph />
                      </RowAction>
                    )}
                    <RowAction title="Rename" disabled={busy} onClick={() => void renameItem(e)}>
                      <PencilGlyph />
                    </RowAction>
                    <RowAction title="Copy path" disabled={busy} onClick={() => copyPath(e)}>
                      <LinkGlyph />
                    </RowAction>
                    <RowAction title="Move to trash" disabled={busy} onClick={() => void trashItem(e)}>
                      <TrashGlyph />
                    </RowAction>
                  </div>
                </li>
              );
            })}
            {data.items.length === 0 && <li className="px-3 py-2 text-sm opacity-70">Nothing here.</li>}
          </ul>
        )}
      </div>
      {recent.length > 0 && (
        <div className="flex shrink-0 flex-col" style={{ height: recentHeight }}>
          <div
            onMouseDown={startRecentDrag}
            title="Drag to resize"
            className="cursor-row-resize border-t-2 border-border transition-colors hover:border-chartreuse"
          >
            <div className="px-3 py-1 text-xs uppercase tracking-wide opacity-50">Recently opened</div>
          </div>
          <ul className="flex-1 overflow-y-auto text-sm">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openFile(r)}
                  className="flex w-full cursor-pointer items-start gap-2 px-3 py-1 text-left hover:bg-black/5 disabled:opacity-50"
                  title="Open in gmist"
                >
                  <span className="mt-0.5 shrink-0">
                    <KindIcon kind="markdown" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <PathCrumb trail={r.trail} path={r.path} onGo={browseFolder} />
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
