import { data } from "react-router";
import { useCallback, useMemo, useState } from "react";
import type { Route } from "./+types/spike.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocMode, DocRole } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { serializeThreads } from "~/lib/thread-serialization";
import CodeMirrorEditor from "~/components/CodeMirrorEditor";

/**
 * Y.Text core (#13) rollout step 1: the CM6 + Y.Text round-trip spike. A
 * throwaway harness, NOT linked from the app. Open an existing doc at
 * /spike/<id>?k=<key>. It binds CodeMirror 6 to `getText("body")` and shows the
 * save bytes (`serializeThreads(body, [], frontmatter)`) live, so we can prove
 * the round-trip is byte-faithful and paragraph breaks survive an edit, before
 * touching the real editor. "Commit to Drive" runs the genuine write path.
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

  const frontmatter = useMemo(() => {
    return (yjs.doc.getMap<string>("meta").get("frontmatter") as string) ?? "";
  }, [yjs.doc, yjs.synced]);

  const saveBytes = useMemo(
    () => serializeThreads(body, [], frontmatter),
    [body, frontmatter],
  );

  const commit = useCallback(() => {
    const socket = yjs.socket as unknown as { send?: (data: string) => void } | null;
    if (!socket?.send) return;
    socket.send(JSON.stringify({ type: "doc", content: saveBytes, commitNow: true }));
    setCommitted("sent at " + new Date().toISOString());
  }, [yjs.socket, saveBytes]);

  const newlineCount = (saveBytes.match(/\n/g) ?? []).length;
  const blankLineCount = (saveBytes.match(/\n\n/g) ?? []).length;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-paper px-4 py-2 text-sm">
        <strong>Y.Text spike</strong>
        <span className="text-muted">{id}</span>
        <span className={yjs.synced ? "text-emerald-600" : "text-amber-600"}>
          {yjs.synced ? "synced" : "connecting"}
        </span>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "suggest" ? "edit" : "suggest"))}
          className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-border"
        >
          mode: {mode}
        </button>
        <button
          type="button"
          onClick={() => setCleanView((c) => !c)}
          className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-border"
        >
          clean view: {cleanView ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={commit}
          className="ml-auto cursor-pointer rounded border border-border px-3 py-1 hover:bg-border"
        >
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
            onTextChange={setBody}
            className="h-full text-sm"
          />
        </div>
        <div className="flex min-h-0 w-1/2 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted">
            save bytes: {saveBytes.length} chars, {newlineCount} newlines, {blankLineCount} blank-line breaks
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-stone-50 px-4 py-2 font-mono text-xs">
            {saveBytes}
          </pre>
        </div>
      </div>
    </div>
  );
}
