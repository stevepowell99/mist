import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/home";
import { APP_NAME, generateDocumentId } from "~/shared/constants";
import { deserializeThreads } from "~/lib/thread-serialization";
import { ensureDriveKey, clearDriveKey } from "~/lib/drive-key";
import ThemeSelector from "~/components/ThemeSelector";
import demoDocument from "./demo.md?raw";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { origin: url.origin };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "mist" },
    { name: "description", content: "Collaborative markdown editor" },
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { origin } = loaderData;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [ghUrl, setGhUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [driveOpening, setDriveOpening] = useState(false);
  const [driveError, setDriveError] = useState("");

  const curlCommand = `curl ${origin}/new -T file.md`;

  function handleCopy() {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNewDocument() {
    const { body, threads, onboarding, frontmatter } = deserializeThreads(demoDocument);
    const id = generateDocumentId();
    const res = await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, onboarding, frontmatter }),
    });
    const { editKey } = (await res.json()) as { editKey: string };
    navigate(`/docs/${id}?k=${editKey}`);
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const { body, threads, frontmatter } = deserializeThreads(text);
      const id = generateDocumentId();

      // Create the document with initial content + threads via POST body
      const res = await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body, threads, frontmatter }),
      });
      const { editKey } = (await res.json()) as { editKey: string };

      navigate(`/docs/${id}?k=${editKey}`);
    },
    [navigate],
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

  const handleImport = useCallback(async () => {
    if (importing || !ghUrl.trim()) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await fetch("/gh/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ghUrl.trim() }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (res.ok && body.url) {
        navigate(body.url);
      } else {
        setImportError(body.error ?? "import failed");
      }
    } catch {
      setImportError("import failed");
    } finally {
      setImporting(false);
    }
  }, [importing, ghUrl, navigate]);

  const handleDriveOpen = useCallback(async () => {
    if (driveOpening || !driveUrl.trim()) return;
    const key = ensureDriveKey();
    if (!key) return;
    setDriveOpening(true);
    setDriveError("");
    try {
      const res = await fetch("/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Drive-Key": key },
        body: JSON.stringify({ url: driveUrl.trim() }),
      });
      if (res.status === 401) {
        clearDriveKey();
        setDriveError("wrong passphrase, try again");
        return;
      }
      const body = (await res.json()) as { url?: string; error?: string };
      if (res.ok && body.url) {
        navigate(body.url);
      } else {
        setDriveError(body.error ?? "could not open file");
      }
    } catch {
      setDriveError("could not open file");
    } finally {
      setDriveOpening(false);
    }
  }, [driveOpening, driveUrl, navigate]);

  return (
    <>
      <div
        className="relative flex min-h-screen flex-col items-center justify-center px-4"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="absolute right-3 top-3">
          <ThemeSelector />
        </div>
        <h1 className="mb-1 font-bold">{APP_NAME}</h1>
        <p className="mb-8 text-muted">
          Share and edit Markdown together, quickly
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleNewDocument}
            className="cursor-pointer whitespace-nowrap border border-ink bg-ink px-6 py-2 text-paper transition-opacity hover:opacity-80"
          >
            New document
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer whitespace-nowrap border border-border px-6 py-2 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            Drag and drop .md file
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />
        <p className="mt-8 text-muted">Or import a markdown file from a public GitHub repo</p>
        <div className="mt-2 flex w-full max-w-xl items-center gap-2">
          <input
            type="url"
            value={ghUrl}
            onChange={(e) => setGhUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleImport();
            }}
            placeholder="https://github.com/owner/repo/blob/main/doc.md"
            className="min-w-0 flex-1 border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-ink"
            aria-label="GitHub file URL"
          />
          <button
            onClick={handleImport}
            disabled={importing || !ghUrl.trim()}
            className="shrink-0 cursor-pointer whitespace-nowrap border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {importError && <p className="mt-2 text-sm text-coral">{importError}</p>}

        <p className="mt-8 text-muted">Or open a Google Drive markdown file</p>
        <div className="mt-2 flex w-full max-w-xl items-center gap-2">
          <input
            type="url"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDriveOpen();
            }}
            placeholder="https://drive.google.com/file/d/<id>/view"
            className="min-w-0 flex-1 border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-ink"
            aria-label="Google Drive file URL"
          />
          <button
            onClick={handleDriveOpen}
            disabled={driveOpening || !driveUrl.trim()}
            className="shrink-0 cursor-pointer whitespace-nowrap border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            {driveOpening ? "Opening…" : "Open"}
          </button>
        </div>
        {driveError && <p className="mt-2 text-sm text-coral">{driveError}</p>}

        <p className="mt-8 text-muted">Or from your terminal</p>
        <div className="mt-2 flex max-w-full items-center gap-1.5">
          <code className="flex min-w-0 items-center overflow-x-auto font-mono text-base">
            <span className="md-delimiter shrink-0">`</span>
            <span className="md-code whitespace-nowrap">{curlCommand}</span>
            <span className="md-delimiter shrink-0">`</span>
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 cursor-pointer p-1 text-muted hover:text-ink transition-colors"
            aria-label={copied ? "Copied" : "Copy command"}
          >
            {copied ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 z-10 flex items-baseline justify-between border-t border-border bg-paper px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base text-muted">
        <span>
          <span className="whitespace-nowrap">Work in progress.</span> Bugs and
          feedback on{" "}
          <a
            href="https://github.com/inanimate-tech/mist"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink transition-colors hover:text-coral"
          >
            GitHub
          </a>
          .
        </span>
        <span className="font-mono font-light uppercase tracking-wider text-ink">
          MIT licensed
        </span>
      </footer>
    </>
  );
}
