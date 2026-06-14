import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ensureDriveKey, clearDriveKey, getDriveKey } from "~/lib/drive-key";
import type { DriveKind } from "~/lib/google.server";
import type { SearchResult } from "~/routes/drive.search";

/**
 * Drive quick-open: a search box that lists recent files by default and
 * name-matches as you type, with a Type filter (defaulting to markdown and
 * folders so data junk does not crowd out documents). A markdown file opens in
 * mist; a folder drills into its contents; anything else opens in Drive in a new
 * tab. Gated by the shared Drive passphrase (drive-key.ts).
 */

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
    case "pdf":
      return <svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>;
    case "markdown":
      return <svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 17v-4l2 2 2-2v4" /></svg>;
    default:
      return <svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>;
  }
}

export default function DriveQuickOpen() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<DriveKind[]>(["markdown", "folder"]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const fetchResults = useCallback(
    async (opts: { q?: string; folder?: string }) => {
      const key = ensureDriveKey();
      if (!key) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts.q) params.set("q", opts.q);
        if (opts.folder) params.set("folder", opts.folder);
        if (types.length) params.set("types", types.join(","));
        const res = await fetch(`/drive/search?${params.toString()}`, {
          headers: { "X-Drive-Key": key },
        });
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong passphrase, try again");
        }
        const body = (await res.json()) as { results?: SearchResult[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "search failed");
        setResults(body.results ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [types],
  );

  // Load on open; re-run when the query or the type filter changes (debounced).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void fetchResults(query.trim() ? { q: query.trim() } : {}), 250);
    return () => clearTimeout(t);
  }, [open, query, fetchResults]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggleType = useCallback((kind: DriveKind) => {
    setTypes((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }, []);

  const openMd = useCallback(
    async (id: string) => {
      const key = getDriveKey();
      if (!key || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/drive/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Drive-Key": key },
          body: JSON.stringify({ url: id }),
        });
        if (res.status === 401) {
          clearDriveKey();
          throw new Error("wrong passphrase, try again");
        }
        const body = (await res.json()) as { url?: string; error?: string };
        if (body.url) {
          navigate(body.url);
          return;
        }
        throw new Error(body.error ?? "could not open file");
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open file");
        setBusy(false);
      }
    },
    [busy, navigate],
  );

  const onPick = useCallback(
    (r: SearchResult) => {
      if (r.kind === "folder") {
        setQuery("");
        void fetchResults({ folder: r.id });
      } else if (r.openInMist) {
        void openMd(r.id);
      } else if (r.webViewLink) {
        window.open(r.webViewLink, "_blank", "noopener,noreferrer");
      }
    },
    [fetchResults, openMd],
  );

  return (
    <div ref={boxRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Open from Drive"
        aria-label="Open from Drive"
        className="flex shrink-0 items-center gap-1 border-r border-border px-3 transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[48rem] max-w-[95vw] border border-border bg-paper shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Drive files and folders"
            className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none"
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
          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="px-3 py-2 text-sm opacity-70">Searching…</p>}
            {error && <p className="px-3 py-2 text-sm text-coral">{error}</p>}
            {!loading && !error && results.length === 0 && (
              <p className="px-3 py-2 text-sm opacity-70">Nothing found.</p>
            )}
            <ul className="text-sm">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(r)}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-black/5 disabled:opacity-50"
                    title={r.kind === "folder" ? "Open folder" : r.openInMist ? "Open in mist" : "Open in Drive"}
                  >
                    <span className="mt-0.5 shrink-0">
                      <KindIcon kind={r.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {r.path && <span className="block truncate text-xs opacity-50">{r.path}</span>}
                      <span className="block truncate">{r.name}</span>
                    </span>
                    {!r.openInMist && r.kind !== "folder" && (
                      <span className="mt-0.5 shrink-0 text-xs opacity-50">Drive</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
