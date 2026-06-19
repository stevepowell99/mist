import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { KindIcon, Spinner } from "~/components/DriveBrowser";
import { importDriveFile, readJson, SIGN_IN_MSG } from "~/lib/drive-open";
import { getRecentOpened, addRecentOpened, type RecentItem } from "~/lib/drive-recent";
import type { SearchResult } from "~/routes/drive.search";

/**
 * Spotlight-style quick-open: a centred search box that name-matches Drive
 * markdown files (via /drive/search) and opens the chosen one in gmist. Used two
 * ways: as a full-screen launcher page (the /go route, reached by an OS hotkey)
 * and as an in-app Cmd/Ctrl-K overlay (QuickOpenTrigger). Empty query shows the
 * recently-opened list, so the files you actually reuse are one keypress away.
 */

/** A search hit or a recent file, normalised to what the list needs to render
 *  and open. Recents lack a kind, so they default to markdown (the only kind we
 *  open here). */
interface Row {
  id: string;
  name: string;
  path?: string;
  parentId?: string | null;
  trail?: { id: string; name: string }[];
}

function recentToRow(r: RecentItem): Row {
  return { id: r.id, name: r.name, path: r.path, parentId: r.parentId, trail: r.trail };
}

export function QuickOpen({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recents are the empty-query list and the instant first paint (localStorage,
  // read after mount so SSR stays stable).
  const [recent, setRecent] = useState<Row[]>([]);
  useEffect(() => {
    setRecent(getRecentOpened().map(recentToRow));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced Drive name-search; empty query falls back to recents with no fetch.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRows(recent);
      setSel(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q, types: "markdown" });
        const res = await fetch(`/drive/search?${p.toString()}`);
        if (res.status === 401) throw new Error(SIGN_IN_MSG);
        const body = (await readJson(res)) as { results?: SearchResult[]; error?: string };
        if (mine !== reqId.current) return; // superseded
        if (!res.ok) throw new Error(body.error ?? "search failed");
        setRows((body.results ?? []).map((r) => ({ id: r.id, name: r.name, path: r.path, parentId: r.parentId, trail: r.trail })));
        setSel(0);
        setError(null);
      } catch (e) {
        if (mine === reqId.current) {
          setError(e instanceof Error ? e.message : "search failed");
          setRows([]);
        }
      } finally {
        if (mine === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, recent]);

  const open = useCallback(
    async (row: Row) => {
      setBusy(true);
      setError(null);
      try {
        const url = await importDriveFile(row.id);
        addRecentOpened({ id: row.id, name: row.name, path: row.path, parentId: row.parentId, trail: row.trail });
        onClose?.();
        navigate(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open file");
        setBusy(false);
      }
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[sel];
        if (row && !busy) void open(row);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) setQuery("");
        else onClose?.();
      }
    },
    [rows, sel, busy, open, query, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[15vh]"
      onMouseDown={() => onClose?.()}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-paper shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <KindIcon kind="markdown" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Open a Drive markdown file…"
            spellCheck={false}
            className="flex-1 bg-transparent py-3 text-lg outline-none placeholder:text-muted"
          />
          {(loading || busy) && <Spinner />}
        </div>

        {error && <div className="border-b border-border px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 && !loading && (
            <div className="px-3 py-6 text-center text-sm text-muted">
              {query.trim() ? "No matches" : "Recently opened files appear here"}
            </div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseMove={() => setSel(i)}
              onClick={() => void open(r)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === sel ? "bg-black/10" : ""}`}
            >
              <span className="shrink-0 text-muted">
                <KindIcon kind="markdown" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.name}</span>
                {r.path && <span className="block truncate text-xs text-muted">{r.path}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Mounts the palette as a Cmd/Ctrl-K overlay anywhere it is dropped in. The
 * listener is capture-phase so it fires even when CodeMirror has focus. Drop one
 * <QuickOpenTrigger/> into a page; it renders nothing until opened.
 */
export function QuickOpenTrigger() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <QuickOpen onClose={() => setOpen(false)} /> : null;
}
