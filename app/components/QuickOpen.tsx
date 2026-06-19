import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { KindIcon, Spinner } from "~/components/DriveBrowser";
import { importDriveFile, readJson, SIGN_IN_MSG } from "~/lib/drive-open";
import { getRecentOpened, addRecentOpened, type RecentItem } from "~/lib/drive-recent";
import { searchScore } from "~/lib/fuzzy";
import type { DriveKind } from "~/lib/google.server";
import type { SearchResult } from "~/routes/drive.search";

/**
 * Spotlight-style quick-open: a centred search box that name-matches Drive
 * markdown files (via /drive/search) and opens the chosen one in gmist. Used two
 * ways: as a full-screen launcher page (the /go route, reached by an OS hotkey)
 * and as an in-app Cmd/Ctrl-K overlay (QuickOpenTrigger). Empty query at the top
 * level shows the recently-opened list, so files you reuse are one keypress away.
 *
 * Two refinements over a flat file search:
 * - Ranking: results include files whose PARENT folder matched the query (the
 *   server's parents=1 expansion), ranked below direct name hits because
 *   searchScore weights a name hit far above a path hit.
 * - Context: matching folders appear as results too; opening one clears the
 *   query and scopes the search into that folder (a breadcrumb walks back out).
 */

/** A search hit, folder, or recent file, normalised to what the list renders and
 *  acts on. Recents are markdown (a folder is never recent here). */
interface Row {
  id: string;
  name: string;
  kind: DriveKind;
  path?: string;
  parentId?: string | null;
  trail?: { id: string; name: string }[];
  isFolder: boolean;
  /** Surfaced via a parent-folder name match, not its own name. */
  viaParent?: boolean;
}

/** The folder the search is scoped into, with its ancestors (top -> parent) for
 *  the breadcrumb. null is the whole Drive. */
interface Context {
  id: string;
  name: string;
  crumbs: { id: string; name: string }[];
}

function recentToRow(r: RecentItem): Row {
  return { id: r.id, name: r.name, kind: "markdown", path: r.path, parentId: r.parentId, trail: r.trail, isFolder: false };
}

function resultToRow(r: SearchResult): Row {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    path: r.path,
    parentId: r.parentId,
    trail: r.trail,
    isFolder: r.kind === "folder",
    viaParent: r.viaParent,
  };
}

export function QuickOpen({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const [query, setQuery] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recents are the top-level empty-query list and the instant first paint
  // (localStorage, read after mount so SSR stays stable).
  const [recent, setRecent] = useState<Row[]>([]);
  useEffect(() => {
    setRecent(getRecentOpened().map(recentToRow));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch logic: at the top level with no query, show recents (no fetch); in a
  // folder context list its contents; a query searches (scoped to the context if
  // any, else with the parent-folder expansion).
  useEffect(() => {
    const q = query.trim();
    if (!q && !context) {
      setRows(recent);
      setSel(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ types: "markdown,folder" });
        if (q) p.set("q", q);
        if (context) p.set("folder", context.id);
        else p.set("parents", "1");
        const res = await fetch(`/drive/search?${p.toString()}`);
        if (res.status === 401) throw new Error(SIGN_IN_MSG);
        const body = (await readJson(res)) as { results?: SearchResult[]; error?: string };
        if (mine !== reqId.current) return; // superseded
        if (!res.ok) throw new Error(body.error ?? "search failed");
        let next = (body.results ?? []).map(resultToRow);
        // Rank by name hit first, parent/path hit a distant second. The folder
        // listing (no query) keeps the server's folder-then-name order.
        if (q) {
          next = next
            .map((r) => ({ r, s: searchScore(q, r.name, r.path ?? "") ?? -1 }))
            .sort((a, b) => b.s - a.s)
            .map((x) => x.r);
        }
        setRows(next);
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
  }, [query, context, recent]);

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

  /** Scope into a folder: push it onto the context and clear the query, so it
   *  lists the folder's contents (filterable by typing again). */
  const enterFolder = useCallback((row: Row) => {
    setContext({ id: row.id, name: row.name, crumbs: row.trail ?? [] });
    setQuery("");
  }, []);

  /** Jump the context to an ancestor crumb (or the whole Drive when null). */
  const goToCrumb = useCallback((c: Context | null) => {
    setContext(c);
    setQuery("");
  }, []);

  /** Pop one folder level: to the immediate parent, or out to the whole Drive. */
  const popContext = useCallback(() => {
    setContext((ctx) => {
      if (!ctx) return null;
      const crumbs = ctx.crumbs;
      if (!crumbs.length) return null;
      const last = crumbs[crumbs.length - 1];
      return { id: last.id, name: last.name, crumbs: crumbs.slice(0, -1) };
    });
    setQuery("");
  }, []);

  const activate = useCallback(
    (row: Row) => {
      if (row.isFolder) enterFolder(row);
      else if (!busy) void open(row);
    },
    [busy, enterFolder, open],
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
        if (row) activate(row);
      } else if (e.key === "Backspace" && !query && context) {
        // Backspace on an empty box walks back up out of the folder context.
        e.preventDefault();
        popContext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) setQuery("");
        else if (context) popContext();
        else onClose?.();
      }
    },
    [rows, sel, activate, query, context, popContext, onClose],
  );

  const emptyMsg = loading
    ? ""
    : query.trim()
      ? "No matches"
      : context
        ? "This folder is empty"
        : "Recently opened files appear here";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[15vh]"
      onMouseDown={() => onClose?.()}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-paper shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb: shown only inside a folder context, so the box is plain at
            the top level. Each crumb jumps the scope; Drive resets to everything. */}
        {context && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-xs text-muted">
            <button type="button" className="hover:text-ink" onClick={() => goToCrumb(null)}>
              Drive
            </button>
            {context.crumbs.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <span aria-hidden>›</span>
                <button
                  type="button"
                  className="hover:text-ink"
                  onClick={() => goToCrumb({ id: c.id, name: c.name, crumbs: context.crumbs.slice(0, i) })}
                >
                  {c.name}
                </button>
              </span>
            ))}
            <span aria-hidden>›</span>
            <span className="text-ink">{context.name}</span>
          </div>
        )}

        <div className="flex items-center gap-2 border-b border-border px-3">
          <span className="text-muted">
            <KindIcon kind={context ? "folder" : "markdown"} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={context ? `Filter in ${context.name}…` : "Open a Drive markdown file…"}
            spellCheck={false}
            className="flex-1 bg-transparent py-3 text-lg outline-none placeholder:text-muted"
          />
          {(loading || busy) && <Spinner />}
        </div>

        {error && <div className="border-b border-border px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 && !loading && (
            <div className="px-3 py-6 text-center text-sm text-muted">{emptyMsg}</div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseMove={() => setSel(i)}
              onClick={() => activate(r)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === sel ? "bg-black/10" : ""}`}
            >
              <span className="shrink-0 text-muted">
                <KindIcon kind={r.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.name}</span>
                {r.path && <span className="block truncate text-xs text-muted">{r.path}</span>}
              </span>
              {r.isFolder && <span className="shrink-0 text-muted" aria-hidden>›</span>}
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
