import { data } from "react-router";
import { useCallback, useMemo, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Route } from "./+types/spike.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocMode, DocRole } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { useTextThreads } from "~/lib/useTextThreads";
import { serializeThreads } from "~/lib/thread-serialization";
import type { BibLibrary } from "~/lib/citations";
import CodeMirrorEditor from "~/components/CodeMirrorEditor";

// A small static library so the @-picker can be exercised on the spike. The
// real editor will pass the document's loaded bib (the same shape).
const DEMO_BIB: BibLibrary = new Map([
  ["smith2020", { authors: ["Smith"], year: "2020", title: "Causal maps in practice" }],
  ["jones2019", { authors: ["Jones", "Patel"], year: "2019", title: "Qualitative system dynamics" }],
  ["powell2021", { authors: ["Powell"], year: "2021", title: "Theory of change methods" }],
]);

/**
 * Y.Text core (#13) rollout spike. A throwaway harness, NOT linked from the
 * app. Open an existing doc at /spike/<id>?k=<key>. It binds CodeMirror 6 to
 * `getText("body")` and exercises the new core: byte-faithful save bytes,
 * CriticMarkup rendering, suggest mode, clean view, and comment threads.
 * "Commit to Drive" runs the genuine write path.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }
  const docKey = new URL(request.url).searchParams.get("k");
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request(`https://do/?k=${encodeURIComponent(docKey ?? "")}`));
  const { exists, role } = (await res.json()) as { exists: boolean; role: DocRole | null };
  if (!exists || !role) {
    throw data(null, { status: 404 });
  }
  return { id, docKey, role };
}

export default function SpikePage({ loaderData }: Route.ComponentProps) {
  return <SpikeRoot key={loaderData.id} {...loaderData} />;
}

function SpikeRoot({ id, docKey }: { id: string; docKey: string | null; role: DocRole }) {
  const yjs = useYjsEditor(id, docKey);
  const [body, setBody] = useState("");
  const [committed, setCommitted] = useState<string | null>(null);
  const [mode, setMode] = useState<DocMode>("suggest");
  const [cleanView, setCleanView] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);

  const frontmatter = useMemo(() => {
    return (yjs.doc.getMap<string>("meta").get("frontmatter") as string) ?? "";
  }, [yjs.doc, yjs.synced]);

  const t = useTextThreads({ doc: yjs.doc, view, text: body, user: yjs.user });

  const saveBytes = useMemo(
    () => serializeThreads(body, t.threads, frontmatter),
    [body, t.threads, frontmatter],
  );

  const addComment = useCallback(() => {
    const note = window.prompt("Comment:");
    if (note) t.createComment(note);
  }, [t]);

  const commit = useCallback(() => {
    const socket = yjs.socket as unknown as { send?: (data: string) => void } | null;
    if (!socket?.send) return;
    socket.send(JSON.stringify({ type: "doc", content: saveBytes, commitNow: true }));
    setCommitted("sent");
  }, [yjs.socket, saveBytes]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-paper px-4 py-2 text-sm">
        <strong>Y.Text spike</strong>
        <span className="text-muted">{id}</span>
        <span className={yjs.synced ? "text-emerald-600" : "text-amber-600"}>
          {yjs.synced ? "synced" : "connecting"}
        </span>
        <button type="button" onClick={() => setMode((m) => (m === "suggest" ? "edit" : "suggest"))} className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-border">
          mode: {mode}
        </button>
        <button type="button" onClick={() => setCleanView((c) => !c)} className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-border">
          clean view: {cleanView ? "on" : "off"}
        </button>
        <button type="button" onClick={addComment} className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-border">
          + comment
        </button>
        <button type="button" onClick={commit} className="ml-auto cursor-pointer rounded border border-border px-3 py-1 hover:bg-border">
          Commit to Drive
        </button>
        {committed && <span className="text-muted">{committed}</span>}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto border-r border-border">
          <CodeMirrorEditor
            doc={yjs.doc}
            awareness={yjs.awareness}
            mode={mode}
            cleanView={cleanView}
            activeComment={t.activeRange}
            bibLibrary={DEMO_BIB}
            onTextChange={setBody}
            onViewReady={setView}
            className="h-full text-sm"
          />
        </div>
        <div className="flex min-h-0 w-2/5 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto border-b border-border">
            <div className="border-b border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted">
              Comments ({t.threads.length})
            </div>
            {t.threads.length === 0 && <p className="px-3 py-2 text-sm text-muted">No comments. Select text and press + comment.</p>}
            {t.threads.map((thread) => (
              <div
                key={thread.id}
                className={`cursor-pointer border-b border-border px-3 py-2 text-sm hover:bg-stone-50 ${thread.id === t.activeThreadId ? "bg-canary/15" : ""} ${thread.resolved ? "opacity-50" : ""}`}
                onClick={() => t.jumpToThread(thread)}
              >
                {thread.highlightText && (
                  <div className="mb-0.5 truncate text-xs text-muted">on "{thread.highlightText}"</div>
                )}
                <div>{thread.commentText}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {thread.author.name}
                  {thread.position === undefined && " · orphaned"}
                </div>
                {thread.replies.map((r) => (
                  <div key={r.id} className="mt-1 border-l-2 border-border pl-2 text-xs">
                    <span className="text-muted">{r.author.name}: </span>{r.text}
                  </div>
                ))}
                <div className="mt-1 flex gap-2 text-xs">
                  <button type="button" onClick={(e) => { e.stopPropagation(); const r = window.prompt("Reply:"); if (r) t.addReply(thread.id, r); }} className="cursor-pointer text-coral hover:underline">reply</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); t.resolveThread(thread.id); }} className="cursor-pointer text-muted hover:underline">{thread.resolved ? "reopen" : "resolve"}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); t.deleteThread(thread.id); }} className="cursor-pointer text-muted hover:underline">delete</button>
                </div>
              </div>
            ))}
          </div>
          <pre className="h-2/5 shrink-0 overflow-auto whitespace-pre-wrap bg-stone-50 px-4 py-2 font-mono text-xs">
            {saveBytes}
          </pre>
        </div>
      </div>
    </div>
  );
}
