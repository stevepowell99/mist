import { useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/home";
import { APP_NAME, generateDocumentId } from "~/shared/constants";
import { deserializeThreads } from "~/lib/thread-serialization";
import ThemeSelector from "~/components/ThemeSelector";
import DriveBrowser from "~/components/DriveBrowser";
import GoogleSignIn from "~/components/GoogleSignIn";
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

export default function Home(_props: Route.ComponentProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          <span>or drag a .md file onto the page</span>
        </div>
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
