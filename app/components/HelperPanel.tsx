import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { planHelperEdits, type HelperOp, type HelperOutcome } from "~/lib/helper-edits";
import { fadeHelperMarks, helperEditSpec, helperMarkAt, helperUndoSpec } from "~/lib/cm-helper-marks";
import { HISTORY_TURNS, type HelperMessage } from "~/lib/helper-prompt";
import { revealPos } from "~/lib/cm-reveal";
import { trustedClick } from "~/lib/trusted-click";

/**
 * The helper: a chat beside the document that can change it.
 *
 * It follows the house pattern of the other Causal Map helpers (MapCat, the
 * Qualia Workshops Assistant, the QualiaInterviews Advisor): a panel opened
 * from the bar, Enter to send, a thinking line instead of streaming, a Clear
 * button, and the changes listed under the reply that made them. Unlike them it
 * applies the changes at once, because they are edits in the user's own editor:
 * each one is highlighted, the reply's Undo takes them back, and so does
 * Ctrl+Z, which sees the helper's edit as one step. In Suggesting mode the
 * changes arrive as tracked changes instead, to accept or reject.
 *
 * The edits go into the editor as ordinary transactions, so autosave, the
 * conflict guard and undo treat them exactly like typing. They are applied to
 * the text as it is when the reply arrives, found by their words
 * (`planHelperEdits`), so anything typed while the model was thinking stays.
 */
interface Entry {
  id: string;
  role: "user" | "assistant";
  text: string;
  outcomes?: HelperOutcome[];
  /** Edits in the reply that were not usable at all. */
  rejected?: number;
  unparsed?: boolean;
  error?: boolean;
  seconds?: number;
  undone?: boolean;
  /** Undo was pressed after the text had been edited, so it did nothing. */
  undoRefused?: boolean;
  /** Read back from storage: its marks belonged to an editor that is gone. */
  restored?: boolean;
}

const KEEP = 40;
const FADE_MS = 8000;
const storeKey = (fileId: string) => `gmist.helper.${fileId}`;

function load(fileId: string): Entry[] {
  try {
    const raw = localStorage.getItem(storeKey(fileId));
    const list = raw ? (JSON.parse(raw) as Entry[]) : [];
    return Array.isArray(list) ? list.map((e) => ({ ...e, restored: true })) : [];
  } catch {
    return [];
  }
}

function save(fileId: string, entries: Entry[]) {
  try {
    if (entries.length) localStorage.setItem(storeKey(fileId), JSON.stringify(entries.slice(-KEEP)));
    else localStorage.removeItem(storeKey(fileId));
  } catch {
    // a full or blocked store loses only the chat, never the document
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** What the model sees of an earlier turn: the words, and whether it changed anything. */
function asHistory(e: Entry): HelperMessage {
  if (e.role === "user") return { role: "user", text: e.text };
  const n = e.outcomes?.filter((o) => o.applied).length ?? 0;
  const note = n ? `\n(${n} change${n === 1 ? "" : "s"} applied to the document${e.undone ? ", since undone" : ""}.)` : "";
  return { role: "assistant", text: e.text + note };
}

export default function HelperPanel({
  view,
  fileId,
  name,
  mode,
  frozen,
  onClose,
}: {
  view: EditorView | null;
  fileId: string;
  name: string;
  mode: "edit" | "suggest";
  /** The buffer is frozen (a file conflict): answer, but change nothing. */
  frozen: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busySince, setBusySince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const stopRef = useRef<{ stop: AbortController; run: string } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Read when the reply lands, not when it was asked: the editor, the mode and
  // the conflict state can all change in the half-minute between.
  const live = useRef({ view, mode, frozen });
  useEffect(() => {
    live.current = { view, mode, frozen };
  });

  // localStorage exists only on the client, so the chat is restored after mount.
  useEffect(() => setEntries(load(fileId)), [fileId]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, busySince]);
  useEffect(() => {
    if (busySince === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busySince]);
  useEffect(() => () => stopRun(), []);

  /**
   * Stop the run: drop the reply and kill the process. Dropping the request
   * alone does not reach the sidecar (workerd keeps its subrequest going), so
   * the run is named in a request of its own.
   */
  function stopRun() {
    const current = stopRef.current;
    if (!current) return;
    current.stop.abort();
    void fetch("/local/helper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel: current.run }),
      keepalive: true,
    }).catch(() => {});
  }

  const update = (fn: (prev: Entry[]) => Entry[]) =>
    setEntries((prev) => {
      const next = fn(prev);
      save(fileId, next);
      return next;
    });

  const send = async () => {
    const message = input.trim();
    const v = live.current.view;
    if (!message || busySince !== null || !v) return;
    const history = entries.filter((e) => !e.error).map(asHistory);
    update((prev) => [...prev, { id: newId(), role: "user", text: message }]);
    setInput("");
    const stop = new AbortController();
    const run = newId();
    stopRef.current = { stop, run };
    const started = Date.now();
    setBusySince(started);
    setNow(started);
    const sel = v.state.selection.main;
    try {
      const res = await fetch("/local/helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: stop.signal,
        body: JSON.stringify({
          id: run,
          name,
          document: v.state.doc.toString(),
          selection: sel.empty ? undefined : v.state.sliceDoc(sel.from, sel.to),
          mode: live.current.mode,
          history,
          message,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        reply?: string;
        edits?: HelperOp[];
        rejected?: number;
        unparsed?: boolean;
      };
      if (!res.ok || data.error) throw new Error(data.error || `The helper failed (${res.status}).`);

      const turn = newId();
      const edits = data.edits ?? [];
      let outcomes: HelperOutcome[] = [];
      const target = live.current.view;
      if (edits.length && (live.current.frozen || !target)) {
        outcomes = edits.map((op) => ({ op, applied: false, why: "the file is in conflict, so the editor is frozen" }));
      } else if (edits.length && target) {
        const plan = planHelperEdits(target.state.doc.toString(), edits, live.current.mode);
        outcomes = plan.outcomes;
        if (plan.changes.length) {
          target.dispatch(helperEditSpec(target.state, turn, plan.changes));
          setTimeout(() => live.current.view?.dispatch(fadeHelperMarks()), FADE_MS);
        }
      }
      update((prev) => [
        ...prev,
        {
          id: turn,
          role: "assistant",
          text: data.reply || (outcomes.length ? "" : "(No answer.)"),
          outcomes,
          rejected: data.rejected,
          unparsed: data.unparsed,
          seconds: Math.round((Date.now() - started) / 1000),
        },
      ]);
    } catch (err) {
      const stopped = stop.signal.aborted;
      update((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          text: stopped ? "Stopped. Nothing was changed." : err instanceof Error ? err.message : "The helper failed.",
          error: true,
        },
      ]);
    } finally {
      stopRef.current = null;
      setBusySince(null);
    }
  };

  const undo = (entry: Entry) => {
    const v = live.current.view;
    if (!v) return;
    const spec = helperUndoSpec(v.state, entry.id);
    if (spec) v.dispatch(spec);
    update((prev) => prev.map((e) => (e.id === entry.id ? { ...e, undone: !!spec, undoRefused: !spec } : e)));
  };

  const jump = (entry: Entry, index: number) => {
    const v = live.current.view;
    const mark = v ? helperMarkAt(v.state, entry.id, index) : null;
    if (!v || !mark) return;
    revealPos(v, mark.from);
    v.focus();
  };

  const close = () => {
    onClose();
    live.current.view?.focus();
  };

  return (
    <div
      className="flex h-full flex-col border-l border-border text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-muted">Helper</span>
        <button
          type="button"
          onClick={() => update(() => [])}
          disabled={!entries.length || busySince !== null}
          title="Start the conversation again. The document keeps every change."
          className="ml-auto cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={close}
          title="Close (Esc)"
          className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
        >
          Close
        </button>
      </div>
      <p className="border-b border-border px-3 py-2 text-xs text-muted">
        Ask about this document, or ask for a change: it edits the text directly, and Undo or Ctrl+Z
        takes a change back. In Suggesting mode its changes arrive as tracked changes. It runs
        Claude Code on this machine, sees the whole document and the last {HISTORY_TURNS} messages,
        and takes ten to thirty seconds.
      </p>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {!entries.length && busySince === null && (
          <p className="py-2 text-xs text-muted">
            Select a passage first to ask about just that. Try asking it to tighten a paragraph, add
            a heading, or check the argument.
          </p>
        )}
        {entries.map((e) =>
          e.role === "user" ? (
            <div key={e.id} className="my-2 ml-8 whitespace-pre-wrap break-words bg-border/50 px-2 py-1.5">
              {e.text}
            </div>
          ) : (
            <div key={e.id} className="my-2 mr-4">
              {e.error ? (
                <p className="text-xs text-rose-600">{e.text}</p>
              ) : (
                <AssistantText text={e.text} />
              )}
              {e.unparsed && (
                <p className="mt-1 text-xs text-muted">The answer was not in the form asked for, so nothing was changed.</p>
              )}
              {!!e.rejected && (
                <p className="mt-1 text-xs text-muted">
                  {e.rejected} proposed change{e.rejected === 1 ? " was" : "s were"} not usable and left out.
                </p>
              )}
              {e.outcomes && e.outcomes.length > 0 && (
                <Changes entry={e} onJump={(i) => jump(e, i)} onUndo={() => undo(e)} />
              )}
            </div>
          ),
        )}
        {busySince !== null && (
          <p className="my-2 text-xs text-muted">Thinking… {Math.max(0, Math.round((now - busySince) / 1000))} s</p>
        )}
      </div>

      <div className="border-t border-border p-2">
        <textarea
          ref={inputRef}
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask, or ask for a change · Enter to send · Shift+Enter for a new line"
          className="w-full resize-none border border-border bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink"
        />
        {/* Right padding clears the Help panel's fixed ? button, which sits over
            this corner of the window. */}
        <div className="mt-1 flex items-center gap-2 pr-12">
          {mode === "suggest" && <span className="text-xs text-muted">Suggesting: changes arrive as tracked changes</span>}
          {busySince !== null ? (
            <button
              type="button"
              onClick={stopRun}
              className="ml-auto cursor-pointer border border-border px-3 py-1 text-xs uppercase tracking-wider text-ink hover:bg-border"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || !view}
              className="ml-auto cursor-pointer border border-border px-3 py-1 text-xs uppercase tracking-wider text-ink hover:bg-border disabled:cursor-default disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The assistant's markdown, rendered once per text (never a fresh object to
 *  `dangerouslySetInnerHTML`, which would re-render it on every keystroke). */
function AssistantText({ text }: { text: string }) {
  const html = useMemo(
    () => ({ __html: DOMPurify.sanitize(marked.parse(text, { async: false }) as string) }),
    [text],
  );
  if (!text) return null;
  return (
    <div
      className="break-words text-sm text-ink [&_code]:font-mono [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={html}
    />
  );
}

/** What one reply did to the document: each change as removed and added text,
 *  clickable to scroll to it, each skip with its reason, and the Undo. */
function Changes({ entry, onJump, onUndo }: { entry: Entry; onJump: (index: number) => void; onUndo: () => void }) {
  const outcomes = entry.outcomes ?? [];
  const applied = outcomes.filter((o) => o.applied).length;
  const skipped = outcomes.length - applied;
  const state = entry.undone
    ? "Undone"
    : applied
      ? `Changed ${applied} passage${applied === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}`
      : `Changed nothing: skipped ${skipped}`;
  const canUndo = applied > 0 && !entry.undone && !entry.restored;
  return (
    <div className="mt-2 border-l-2 border-border pl-2">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-muted">{state}</span>
        {canUndo && (
          <button
            type="button"
            onClick={trustedClick(onUndo)}
            className="ml-auto cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-ink"
          >
            Undo
          </button>
        )}
      </div>
      {entry.undoRefused && (
        <p className="text-xs text-amber-600">
          The changed text has been edited since, so Undo here would overwrite that. Ctrl+Z in the
          editor steps back through both.
        </p>
      )}
      {outcomes.map((o, i) =>
        o.applied ? (
          <button
            key={i}
            type="button"
            onClick={() => onJump(i)}
            disabled={entry.undone || entry.restored}
            className="mt-1 block w-full cursor-pointer text-left disabled:cursor-default"
          >
            {o.op.op === "comment" && <span className="block text-xs text-muted">Comment</span>}
            {o.removed && (
              <span className="line-clamp-4 block break-words text-xs text-rose-600 line-through">{o.removed}</span>
            )}
            {o.added && <span className="line-clamp-4 block break-words text-xs text-emerald-700">{o.added}</span>}
          </button>
        ) : (
          <p key={i} className="mt-1 break-words text-xs text-muted">
            Skipped{"find" in o.op && o.op.find ? ` "${o.op.find.slice(0, 60)}${o.op.find.length > 60 ? "…" : ""}"` : ""}: {o.why}
          </p>
        ),
      )}
    </div>
  );
}
