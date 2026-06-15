import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { modAltChord } from "~/lib/chord";
import DriveBrowser, { KindIcon, Spinner } from "~/components/DriveBrowser";
import type { GitHubMeta } from "~/shared/types";

/**
 * Slide-out folder navigator for a folder-backed document. For Drive docs it
 * embeds the shared DriveBrowser (search + browse, starting at the doc's own
 * folder so siblings show). For GitHub docs it browses the repo folder via
 * /docs/:id/folder. The trigger sits in the header.
 */

interface GhEntry {
  name: string;
  isFolder: boolean;
  ref: string;
}

interface GhListing {
  entries: GhEntry[];
  folderRef: string | null;
  parentRef: string | null;
  currentPath: string | null;
  folderName: string | null;
}

function GithubBrowse({ github, docId, docKey }: { github: GitHubMeta; docId: string; docKey: string | null }) {
  const navigate = useNavigate();
  const [data, setData] = useState<GhListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (ref: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (docKey) params.set("k", docKey);
        if (ref != null) params.set("ref", ref);
        const res = await fetch(`/docs/${docId}/folder?${params.toString()}`);
        if (!res.ok) throw new Error(`could not load folder (${res.status})`);
        setData((await res.json()) as GhListing);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load folder");
      } finally {
        setLoading(false);
      }
    },
    [docId, docKey],
  );

  useEffect(() => {
    if (!data && !loading) void load(null);
  }, [data, loading, load]);

  const openFile = useCallback(
    async (ref: string) => {
      setBusy(true);
      setError(null);
      try {
        const encPath = ref.split("/").map(encodeURIComponent).join("/");
        const blobUrl = `https://github.com/${github.owner}/${github.repo}/blob/${github.branch}/${encPath}`;
        const res = await fetch("/gh/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blobUrl }),
        });
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
    [github, navigate],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {busy && (
        <div className="fixed inset-x-0 bottom-0 top-[var(--header-h,0px)] z-[60] flex items-center justify-center bg-paper/70 text-ink">
          <Spinner />
        </div>
      )}
      {data?.folderName && (
        <div className="truncate border-b border-border px-3 py-1 text-xs opacity-60">{data.folderName}</div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-3 py-2 text-sm opacity-70">Loading…</p>}
        {error && <p className="px-3 py-2 text-sm text-coral">{error}</p>}
        {data && !loading && (
          <ul className="text-sm">
            {data.parentRef !== null && (
              <li>
                <button
                  type="button"
                  onClick={() => void load(data.parentRef)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-black/5"
                >
                  <KindIcon kind="folder" />
                  <span className="opacity-70">..</span>
                </button>
              </li>
            )}
            {data.entries.map((e) => (
              <li key={e.ref}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (e.isFolder ? void load(e.ref) : void openFile(e.ref))}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-black/5 disabled:opacity-50 ${e.ref === data.currentPath ? "font-semibold" : ""}`}
                >
                  <KindIcon kind={e.isFolder ? "folder" : "markdown"} />
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
            {data.entries.length === 0 && <li className="px-3 py-2 text-sm opacity-70">No markdown files here.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function FolderSidebar() {
  const { github, drive, docId, docKey } = useDocument();
  // Pinned by a click (stays, with a backdrop) or peeked by hover (closes when
  // the mouse leaves the trigger or panel), mirroring the right comment panel.
  // The trigger and panel are separate regions with a gap, so a short close
  // delay lets the mouse travel from one to the other without the peek closing.
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const open = pinned || peek;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPeek(false), 200);
  }, [cancelClose]);
  const openPeek = useCallback(() => {
    cancelClose();
    setPeek(true);
    setEverOpened(true);
  }, [cancelClose]);

  // Ctrl/Cmd+Alt+F toggles the Drive/files sidebar (pinned), matching the
  // mod+alt shortcut scheme the rest of the layout uses. Owned here because the
  // open state lives here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modAltChord(e) !== "f") return;
      e.preventDefault();
      setPeek(false);
      setPinned((v) => !v);
      setEverOpened(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!github && !drive) return null;

  return (
    <>
      {/* Far-left hover zone: nudging the mouse to the left margin peeks the
          sidebar open, the same as hovering the trigger. */}
      <div
        onMouseEnter={openPeek}
        onMouseLeave={scheduleClose}
        aria-hidden="true"
        className="fixed bottom-0 left-0 top-[var(--header-h,0px)] z-30 w-1.5"
      />
      <button
        type="button"
        onClick={() => {
          setPinned((v) => !v);
          setEverOpened(true);
        }}
        onMouseEnter={openPeek}
        onMouseLeave={scheduleClose}
        title="Open from Drive (Ctrl/Cmd+Alt+F)"
        aria-label="Open from Drive"
        className="flex shrink-0 cursor-pointer items-center border-r border-border px-3 transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {pinned && (
        <button
          type="button"
          aria-label="Close folder"
          onClick={() => setPinned(false)}
          className="fixed inset-x-0 bottom-0 top-[var(--header-h,0px)] z-40 cursor-default bg-black/30"
        />
      )}
      {/* Kept mounted once opened so reopening shows the cached folder instantly.
          Opens below the header (--header-h) so the top bar stays usable.
          Hover peeks; leaving closes the peek but a pinned panel stays. */}
      {everOpened && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed left-0 top-[var(--header-h,0px)] z-50 flex h-[calc(100dvh-var(--header-h,0px))] w-[48rem] max-w-[95vw] flex-col border-r border-border bg-paper shadow-lg ${open ? "" : "hidden"}`}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="font-medium">Drive</span>
            <button
              type="button"
              onClick={() => {
                setPinned(false);
                setPeek(false);
              }}
              aria-label="Close"
              className="cursor-pointer px-2 text-lg leading-none"
            >
              &times;
            </button>
          </div>
          {drive ? (
            <DriveBrowser startFolderId={drive.folderId ?? null} currentFileId={drive.fileId} className="flex-1" />
          ) : github ? (
            <GithubBrowse github={github} docId={docId} docKey={docKey} />
          ) : null}
        </div>
      )}
    </>
  );
}
