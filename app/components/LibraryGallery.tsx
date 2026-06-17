import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { deckSlides } from "~/lib/slides-build";
import type { SearchResult } from "~/routes/drive.search";

/**
 * The reusable slide/image library gallery (plans/slide-image-library.md).
 *  - Slides: `.md` fragments from the library `slides/` folder; click inserts
 *    the fragment markdown at the cursor.
 *  - Images: pictures from `images/`; click inserts `![](drive:<id>)`, a portable
 *    by-id reference resolved at render time.
 *  - From a deck: search ANY deck you can open, pick one slide, insert its raw
 *    markdown.
 * The search box matches filename AND content (full-text), so a deck found by its
 * title works even when its filename is generic. Opened by the header button or
 * the `/library` slash command.
 */
type Tab = "slides" | "images" | "deck";

export default function LibraryGallery() {
  const { view, assetToken } = useDocument();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("slides");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<{ slides: string | null; images: string | null }>({ slides: null, images: null });
  const [items, setItems] = useState<SearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // "From a deck": the deck whose slides are being shown, and its slides.
  const [deckPick, setDeckPick] = useState<{ id: string; name: string } | null>(null);
  const [deckSlideList, setDeckSlideList] = useState<{ index: number; raw: string; title: string }[]>([]);

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

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Resolve the library once on first open.
  useEffect(() => {
    if (!open || configured !== null) return;
    void (async () => {
      try {
        const lib = (await (await fetch("/drive/library")).json()) as {
          configured: boolean;
          slides?: string | null;
          images?: string | null;
        };
        setConfigured(lib.configured);
        setFolders({ slides: lib.slides ?? null, images: lib.images ?? null });
      } catch {
        setConfigured(false);
      }
    })();
  }, [open, configured]);

  // Fetch the active tab's list (re-runs on tab / query / folders change). The
  // "deck" tab needs a query (it searches all of Drive); slides/images list their
  // folder when the query is empty, and search within it (name + full-text) when
  // it is not.
  useEffect(() => {
    if (!open || configured !== true) return;
    if (deckPick) return; // showing a picked deck's slides, not a list
    const folder = tab === "slides" ? folders.slides : tab === "images" ? folders.images : null;
    if (tab !== "deck" && !folder) {
      setItems([]);
      return;
    }
    if (tab === "deck" && !debounced) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    const types = tab === "images" ? "image" : "markdown";
    const p = new URLSearchParams({ types });
    if (folder) p.set("folder", folder);
    if (debounced) {
      p.set("q", debounced);
      p.set("full", "1");
    }
    void (async () => {
      try {
        const res = await fetch(`/drive/search?${p.toString()}`);
        const body = (await res.json()) as { results?: SearchResult[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "search failed");
        setItems(body.results ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, configured, tab, debounced, folders, deckPick]);

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

  const fetchMarkdown = useCallback(async (id: string): Promise<string> => {
    const res = await fetch(`/drive/fragment?id=${encodeURIComponent(id)}`);
    const body = (await res.json()) as { markdown?: string; error?: string };
    if (!res.ok || body.markdown == null) throw new Error(body.error ?? "could not read");
    return body.markdown;
  }, []);

  const insertSlide = useCallback(
    async (item: SearchResult) => {
      setBusyId(item.id);
      setError(null);
      try {
        insertAt(`\n\n${(await fetchMarkdown(item.id)).trim()}\n\n`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not insert");
      } finally {
        setBusyId(null);
      }
    },
    [insertAt, fetchMarkdown],
  );

  const pickDeck = useCallback(
    async (item: SearchResult) => {
      setBusyId(item.id);
      setError(null);
      try {
        const md = await fetchMarkdown(item.id);
        setDeckSlideList(deckSlides(md));
        setDeckPick({ id: item.id, name: item.name });
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open the deck");
      } finally {
        setBusyId(null);
      }
    },
    [fetchMarkdown],
  );

  if (!open) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "slides", label: "Slides" },
    { id: "images", label: "Images" },
    { id: "deck", label: "From a deck" },
  ];
  const searchHint = tab === "deck" ? "Search decks by title or name" : `Search ${tab} by title or name`;
  const folderMissing = configured === true && tab !== "deck" && !(tab === "slides" ? folders.slides : folders.images);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Library"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-paper shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-1">
            <h2 className="mr-3 font-medium text-ink">Library</h2>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setDeckPick(null);
                }}
                className={`cursor-pointer rounded px-2.5 py-1 text-sm transition-colors ${
                  tab === t.id ? "bg-border/60 font-medium text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer px-2 text-xl leading-none text-muted hover:text-ink">
            &times;
          </button>
        </div>

        {configured === true && !deckPick && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchHint}
            aria-label={searchHint}
            className="border-b border-border bg-transparent px-5 py-2 text-sm outline-none"
          />
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm opacity-70">Loading…</p>}
          {error && <p className="text-sm text-coral">{error}</p>}
          {configured === false && (
            <p className="text-sm text-muted">
              No library is configured. Set <span className="font-mono text-ink">LIBRARY_FOLDER_ID</span> to a Drive
              folder with <span className="font-mono text-ink">slides/</span> and{" "}
              <span className="font-mono text-ink">images/</span> subfolders.
            </p>
          )}
          {folderMissing && (
            <p className="text-sm text-muted">
              The library has no <span className="font-mono text-ink">{tab}/</span> subfolder yet.
            </p>
          )}

          {/* From a deck: a picked deck shows its slides; otherwise the search results. */}
          {tab === "deck" && deckPick && (
            <>
              <button type="button" onClick={() => setDeckPick(null)} className="mb-3 cursor-pointer text-sm text-muted hover:text-ink">
                &larr; back to decks
              </button>
              <p className="mb-2 text-sm text-muted">
                Slides in <span className="text-ink">{cleanName(deckPick.name)}</span>:
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {deckSlideList.map((s) => (
                  <li key={s.index}>
                    <button
                      type="button"
                      disabled={!view}
                      onClick={() => insertAt(`\n\n${s.raw}\n\n`)}
                      className="flex w-full cursor-pointer flex-col items-start gap-1 rounded border border-border p-3 text-left transition-colors hover:border-ink disabled:opacity-50"
                    >
                      <span className="font-medium text-ink">{s.title}</span>
                      <span className="text-xs uppercase tracking-wider text-muted">Slide {s.index + 1} · insert at cursor</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === "deck" && !deckPick && !debounced && !loading && (
            <p className="text-sm text-muted">Type to find a deck, then pick one slide from it.</p>
          )}

          {/* Slides tab + deck search results: text cards. */}
          {((tab === "slides") || (tab === "deck" && !deckPick && debounced)) && configured === true && !loading && (
            <ul className="text-sm">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={busyId !== null || (tab === "slides" && !view)}
                    onClick={() => void (tab === "deck" ? pickDeck(it) : insertSlide(it))}
                    className="flex w-full cursor-pointer items-baseline justify-between gap-3 border-b border-border/60 px-1 py-2 text-left hover:bg-black/5 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{cleanName(it.name)}</span>
                      {tab === "deck" && it.path && <span className="block truncate text-xs text-muted">{it.path}</span>}
                    </span>
                    <span className="shrink-0 text-xs uppercase tracking-wider text-muted">
                      {busyId === it.id ? "…" : tab === "deck" ? "open" : "insert"}
                    </span>
                  </button>
                </li>
              ))}
              {items.length === 0 && <li className="py-2 text-sm text-muted">Nothing found.</li>}
            </ul>
          )}

          {/* Images tab: thumbnails. */}
          {tab === "images" && configured === true && !loading && !folderMissing && (
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
              {items.length === 0 && <li className="py-2 text-sm text-muted">Nothing found.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
