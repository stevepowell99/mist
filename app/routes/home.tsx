import { useRef, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/home";
import { APP_NAME, generateDocumentId } from "~/shared/constants";
import { deserializeThreads, serializeThreads } from "~/lib/thread-serialization";
import { getRecentRooms, removeRecentRoom, type RecentRoom } from "~/lib/room-recent";
import ThemeSelector from "~/components/ThemeSelector";
import DriveBrowser from "~/components/DriveBrowser";
import { QuickOpenTrigger } from "~/components/QuickOpen";
import GoogleSignIn from "~/components/GoogleSignIn";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { origin: url.origin };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: APP_NAME },
    { name: "description", content: "Collaborative markdown editor" },
  ];
}

export default function Home(_props: Route.ComponentProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Read after mount: localStorage does not exist during server render.
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  useEffect(() => setRooms(getRecentRooms()), []);

  // Create an unbound room (no Drive file) and open it by its edit link.
  // A failed create must say so rather than leave the button doing nothing.
  const createRoom = useCallback(
    async (seed: Record<string, unknown>) => {
      const id = generateDocumentId();
      const res = await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seed),
      });
      const editKey = res.ok ? ((await res.json()) as { editKey?: string }).editKey : undefined;
      if (!editKey) {
        window.alert(`Could not create the document (${res.status} ${await res.text().catch(() => "")})`.trim());
        return;
      }
      navigate(`/docs/${id}?k=${editKey}`);
    },
    [navigate],
  );

  // A minimal deck: the frontmatter makes it slides, and a level-1 or level-2
  // heading starts each slide.
  async function handleNewDeck() {
    await createRoom({
      content: "---\nformat: revealjs\n---\n\n# Deck title here\n\nSubtitle here\n\n## First slide\n\n- Point one\n- Point two\n",
    });
  }

  async function handleNewDocument() {
    // A visible starting shape, so a newcomer sees a heading and body to overwrite.
    await createRoom({ content: "# Title here\n\nText here\n" });
  }

  const handleUpload = useCallback(
    async (file: File) => {
      // The agent seeds content verbatim, so the file's own frontmatter goes
      // back into it (threads travel separately, as in /new).
      const { body, threads, frontmatter } = deserializeThreads(await file.text());
      await createRoom({ content: serializeThreads(body, [], frontmatter), threads });
    },
    [createRoom],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".md")) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <>
      <QuickOpenTrigger />
      <div
        className="relative flex min-h-screen flex-col items-center justify-center px-4"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="absolute right-3 top-3">
          <ThemeSelector />
        </div>
        <h1 className="mb-1 font-bold">{APP_NAME}</h1>
        <p className="mb-3 text-muted">Open a Google Drive markdown file</p>
        {/* Renders nothing until Google sign-in is configured. */}
        <div className="mb-3 flex min-h-[1.5rem] items-center justify-center">
          <GoogleSignIn />
        </div>
        <div className="h-[58vh] w-full max-w-2xl border border-border text-left">
          <DriveBrowser className="h-full" />
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm text-muted">
          <button
            onClick={handleNewDocument}
            className="cursor-pointer underline-offset-2 hover:text-ink hover:underline"
          >
            New blank document
          </button>
          <button
            onClick={handleNewDeck}
            className="cursor-pointer underline-offset-2 hover:text-ink hover:underline"
          >
            New slide deck
          </button>
          <span>or drag a .md file onto the page</span>
        </div>
        {rooms.length > 0 && (
          <div className="mt-4 mb-16 w-full max-w-2xl text-left text-sm">
            <h2 className="mb-1 text-muted">Shared rooms opened in this browser</h2>
            <ul className="max-h-48 overflow-y-auto border border-border">
              {rooms.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                  <a href={`/docs/${r.id}?k=${encodeURIComponent(r.key)}`} className="truncate text-ink hover:underline">
                    {r.title}
                  </a>
                  <span className="flex shrink-0 items-center gap-3 text-muted">
                    {new Date(r.openedAt).toISOString().slice(0, 10)}
                    <button
                      onClick={() => {
                        removeRecentRoom(r.id);
                        setRooms(getRecentRooms());
                      }}
                      className="cursor-pointer hover:text-ink"
                      title="Remove from this list (the room itself is kept)"
                      aria-label={`Remove ${r.title} from this list`}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      <footer className="fixed bottom-0 left-0 right-0 z-10 flex items-baseline justify-between border-t border-border bg-paper px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base text-muted">
        <span>
          <span className="whitespace-nowrap">Work in progress.</span>
        </span>
        <span className="font-mono font-light uppercase tracking-wider text-ink">
          MIT licensed
        </span>
      </footer>
    </>
  );
}
