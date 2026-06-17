import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { SearchResult } from "~/routes/drive.search";

/**
 * The reusable slide/image library gallery (plans/slide-image-library.md).
 * Slides tab: `.md` fragments from the library's `slides/` folder; clicking one
 * inserts its markdown at the cursor. Images tab: pictures from `images/`;
 * clicking one inserts `![](drive:<id>)`, a portable by-id reference resolved at
 * render time. Opened by the header button or the `/library` slash command.
 */
type Tab = "slides" | "images";

export default function LibraryGallery() {
  const { view, assetToken } = useDocument();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("slides");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<{ slides: string | null; images: string | null }>({ slides: null, images: null });
  const [slides, setSlides] = useState<SearchResult[]>([]);
  const [images, setImages] = useState<SearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mist-toggle-library", toggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mist-toggle-library", toggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const list = useCallback(async (folder: string, types: string): Promise<SearchResult[]> => {
    const res = await fetch(`/drive/search?folder=${encodeURIComponent(folder)}&types=${types}`);
    const body = (await res.json()) as { results?: SearchResult[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? "could not list the library");
    return body.results ?? [];
  }, []);

  // Resolve the library and load both lists, once, on first open.
  useEffect(() => {
    if (!open || configured !== null) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const lib = (await (await fetch("/drive/library")).json()) as {
          configured: boolean;
          slides?: string | null;
          images?: string | null;
        };
        setConfigured(lib.configured);
        if (!lib.configured) return;
        setFolders({ slides: lib.slides ?? null, images: lib.images ?? null });
        if (lib.slides) setSlides(await list(lib.slides, "markdown"));
        if (lib.images) setImages(await list(lib.images, "image"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open the library");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, configured, list]);

  const cleanName = (n: string) => n.replace(/\.(md|qmd)$/i, "");

  const insertAt = useCallback(
    (text: string) => {
      if (!view) return;
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      view.focus();
      setOpen(false);
    },
    [view],
  );

  const insertSlide = useCallback(
    async (item: SearchResult) => {
      setBusyId(item.id);
      setError(null);
      try {
        const res = await fetch(`/drive/fragment?id=${encodeURIComponent(item.id)}`);
        const body = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok || body.markdown == null) throw new Error(body.error ?? "could not read the slide");
        insertAt(`\n\n${body.markdown.trim()}\n\n`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not insert");
      } finally {
        setBusyId(null);
      }
    },
    [insertAt],
  );

  if (!open) return null;
  const folder = tab === "slides" ? folders.slides : folders.images;
  const items = tab === "slides" ? slides : images;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Library"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-paper shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-1">
            <h2 className="mr-3 font-medium text-ink">Library</h2>
            {(["slides", "images"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`cursor-pointer rounded px-2.5 py-1 text-sm capitalize transition-colors ${
                  tab === t ? "bg-border/60 font-medium text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="cursor-pointer px-2 text-xl leading-none text-muted hover:text-ink"
          >
            &times;
          </button>
        </div>
        <div className="px-5 py-4">
          {loading && <p className="text-sm opacity-70">Loading…</p>}
          {error && <p className="text-sm text-coral">{error}</p>}
          {configured === false && !loading && (
            <p className="text-sm text-muted">
              No library is configured. Set <span className="font-mono text-ink">LIBRARY_FOLDER_ID</span> to a Drive
              folder that holds <span className="font-mono text-ink">slides/</span> and{" "}
              <span className="font-mono text-ink">images/</span> subfolders.
            </p>
          )}
          {configured && !loading && !folder && (
            <p className="text-sm text-muted">
              The library has no <span className="font-mono text-ink">{tab}/</span> subfolder yet.
            </p>
          )}
          {configured && folder && items.length === 0 && !loading && (
            <p className="text-sm text-muted">Nothing in {tab} yet.</p>
          )}
          {configured && folder && items.length > 0 && tab === "slides" && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={busyId !== null || !view}
                    onClick={() => void insertSlide(it)}
                    className="flex w-full cursor-pointer flex-col items-start gap-1 rounded border border-border p-3 text-left transition-colors hover:border-ink disabled:opacity-50"
                  >
                    <span className="font-medium text-ink">{cleanName(it.name)}</span>
                    <span className="text-xs uppercase tracking-wider text-muted">
                      {busyId === it.id ? "Inserting…" : "Insert at cursor"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {configured && folder && items.length > 0 && tab === "images" && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!view}
                    onClick={() => insertAt(`![${cleanName(it.name)}](drive:${it.id})`)}
                    title={`Insert ${it.name}`}
                    className="flex w-full cursor-pointer flex-col items-stretch gap-1 rounded border border-border p-2 transition-colors hover:border-ink disabled:opacity-50"
                  >
                    <img
                      src={`/drive/asset?id=${encodeURIComponent(it.id)}&token=${encodeURIComponent(assetToken ?? "")}`}
                      alt={it.name}
                      loading="lazy"
                      className="h-24 w-full rounded object-contain"
                    />
                    <span className="truncate text-xs text-muted" title={it.name}>{it.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
