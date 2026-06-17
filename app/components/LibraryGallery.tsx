import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { SearchResult } from "~/routes/drive.search";

/**
 * The reusable slide/image library gallery (plans/slide-image-library.md). Phase
 * 1: a Slides tab listing the `.md` fragments in the library's `slides/` folder;
 * clicking one inserts its markdown at the cursor. Opened by the header button or
 * the `/library` slash command (the `mist-toggle-library` event). Images and the
 * "from a deck" tab come in later phases.
 */
export default function LibraryGallery() {
  const { view } = useDocument();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [slidesFolder, setSlidesFolder] = useState<string | null>(null);
  const [items, setItems] = useState<SearchResult[]>([]);
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

  // Resolve the library and list its slide fragments, once, on first open.
  useEffect(() => {
    if (!open || configured !== null) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const lib = (await (await fetch("/drive/library")).json()) as {
          configured: boolean;
          slides?: string | null;
        };
        setConfigured(lib.configured);
        if (!lib.configured) return;
        setSlidesFolder(lib.slides ?? null);
        if (lib.slides) {
          const res = await fetch(`/drive/search?folder=${encodeURIComponent(lib.slides)}&types=markdown`);
          const body = (await res.json()) as { results?: SearchResult[]; error?: string };
          if (!res.ok) throw new Error(body.error ?? "could not list the library");
          setItems(body.results ?? []);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not open the library");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, configured]);

  const insert = useCallback(
    async (item: SearchResult) => {
      if (!view) return;
      setBusyId(item.id);
      setError(null);
      try {
        const res = await fetch(`/drive/fragment?id=${encodeURIComponent(item.id)}`);
        const body = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok || body.markdown == null) throw new Error(body.error ?? "could not read the slide");
        const pos = view.state.selection.main.head;
        const text = `\n\n${body.markdown.trim()}\n\n`;
        view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
        view.focus();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not insert");
      } finally {
        setBusyId(null);
      }
    },
    [view],
  );

  if (!open) return null;
  const cleanName = (n: string) => n.replace(/\.(md|qmd)$/i, "");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Slide library"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-paper shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-medium text-ink">Slide library</h2>
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
              folder that holds a <span className="font-mono text-ink">slides/</span> subfolder of{" "}
              <span className="font-mono text-ink">.md</span> fragments.
            </p>
          )}
          {configured && !loading && !slidesFolder && (
            <p className="text-sm text-muted">
              The library folder has no <span className="font-mono text-ink">slides/</span> subfolder yet.
            </p>
          )}
          {configured && slidesFolder && (
            <>
              {items.length === 0 && !loading && <p className="text-sm text-muted">No slide fragments yet.</p>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      disabled={busyId !== null || !view}
                      onClick={() => void insert(it)}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
