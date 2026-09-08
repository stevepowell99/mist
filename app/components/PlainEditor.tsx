import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { markdownLineStyle } from "~/lib/cm-markdown-style";

/**
 * A local file, edited.
 *
 * There is no document here that the editor owns. There is a file, and a buffer
 * in this tab that is a view of it. Everything below follows from that, and it
 * is the whole of the design:
 *
 *  - Save about a second after the typing stops. Saving quickly is what makes
 *    live updating work: the buffer is clean almost all the time, so a change
 *    arriving from elsewhere can be taken silently, with nothing local to weigh
 *    it against. A long interval keeps the buffer dirty and turns every outside
 *    edit into a question.
 *  - Write back the bytes that were read, changed only where the user typed.
 *    Nothing is normalised on the way to disk.
 *  - Poll the file. Clean buffer, take the new version and keep the cursor.
 *    Dirty buffer, say so and let the user choose.
 *  - Never resolve a real clash. Refuse the write, keep a copy, ask.
 */
const SAVE_AFTER_MS = 1000;
const POLL_MS = 700;

type Status = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error";

export default function PlainEditor({ fileId, name }: { fileId: string; name: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /** The version this tab loaded or last wrote: the baseline every write carries. */
  const version = useRef<string | null>(null);
  /** The text as it stood at that moment, so "has the user typed" is answerable. */
  const clean = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [note, setNote] = useState<string | null>(null);

  const docUrl = useCallback(
    (extra = "") => `/local/doc?id=${encodeURIComponent(fileId)}${extra}`,
    [fileId],
  );

  const save = useCallback(async () => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    if (text === clean.current) return;
    setStatus("saving");
    try {
      const expected = version.current ? `&expected=${encodeURIComponent(version.current)}` : "";
      const res = await fetch(docUrl(expected), {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: text,
        cache: "no-store",
      });
      if (res.status === 409) {
        setStatus("conflict");
        setNote("The file changed on disk while you were typing.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setNote("Could not write the file.");
        return;
      }
      const body = (await res.json()) as { version: string | null };
      version.current = body.version;
      clean.current = text;
      setStatus("clean");
      setNote(null);
    } catch {
      setStatus("error");
      setNote("The local file service is not reachable.");
    }
  }, [docUrl]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  /** Replace only the span that differs, so the cursor and the scroll position
   *  survive an outside edit that did not touch the line being worked on. */
  const adopt = useCallback((text: string) => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === text) return;
    let head = 0;
    const max = Math.min(current.length, text.length);
    while (head < max && current[head] === text[head]) head++;
    let tail = 0;
    while (tail < max - head && current[current.length - 1 - tail] === text[text.length - 1 - tail]) {
      tail++;
    }
    v.dispatch({
      changes: {
        from: head,
        to: current.length - tail,
        insert: text.slice(head, text.length - tail),
      },
      // Not a user edit, so it must not mark the buffer dirty or start a save.
      annotations: Transaction.remote.of(true),
    });
  }, []);

  useEffect(() => {
    let stopped = false;

    const read = async () => {
      const res = await fetch(docUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error("could not read the file");
      return (await res.json()) as { text: string; version: string | null };
    };

    void (async () => {
      try {
        const first = await read();
        if (stopped || !host.current) return;
        version.current = first.version;
        clean.current = first.text;
        const state = EditorState.create({
          doc: first.text,
          extensions: [
            lineNumbers(),
            history(),
            drawSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            markdown({ base: markdownLanguage, codeLanguages: [] }),
            markdownLineStyle,
            EditorView.lineWrapping,
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  void saveRef.current();
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return;
              const fromUser = u.transactions.some((tr) => !tr.annotation(Transaction.remote));
              if (!fromUser) return;
              setStatus("dirty");
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => void saveRef.current(), SAVE_AFTER_MS);
            }),
          ],
        });
        view.current = new EditorView({ state, parent: host.current });
        setStatus("clean");
      } catch {
        if (!stopped) {
          setStatus("error");
          setNote("Could not open the file.");
        }
      }
    })();

    const poll = setInterval(() => {
      if (stopped || document.hidden || !view.current) return;
      void (async () => {
        try {
          const res = await fetch(docUrl("&stat=1"), { cache: "no-store" });
          if (!res.ok) return;
          const seen = (await res.json()) as { version: string | null };
          if (stopped || !seen.version || seen.version === version.current) return;
          const next = await read();
          if (stopped || !view.current) return;
          if (view.current.state.doc.toString() !== clean.current) {
            setStatus("conflict");
            setNote("The file changed on disk while you were typing.");
            return;
          }
          adopt(next.text);
          version.current = next.version;
          clean.current = next.text;
          setStatus("clean");
        } catch {
          // briefly unreachable; the next tick tries again
        }
      })();
    }, POLL_MS);

    // Leaving must write. sendBeacon survives the page being torn down, which a
    // fetch started at that moment does not.
    const flush = () => {
      const v = view.current;
      if (!v) return;
      const text = v.state.doc.toString();
      if (text === clean.current) return;
      const expected = version.current ? `&expected=${encodeURIComponent(version.current)}` : "";
      navigator.sendBeacon?.(
        docUrl(expected),
        new Blob([text], { type: "text/markdown; charset=utf-8" }),
      );
    };
    const onHidden = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      stopped = true;
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHidden);
      view.current?.destroy();
      view.current = null;
    };
  }, [docUrl, adopt]);

  /** Take the version on disk, keeping a copy of this buffer first. */
  const takeDisk = useCallback(async () => {
    const v = view.current;
    if (!v) return;
    try {
      await fetch(`/local/recovery?id=${encodeURIComponent(fileId)}`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: v.state.doc.toString(),
        cache: "no-store",
      });
      const res = await fetch(docUrl(), { cache: "no-store" });
      const next = (await res.json()) as { text: string; version: string | null };
      adopt(next.text);
      version.current = next.version;
      clean.current = next.text;
      setStatus("clean");
      setNote("Your version was saved beside the file before it was replaced.");
    } catch {
      setStatus("error");
      setNote("Could not load the file from disk.");
    }
  }, [fileId, docUrl, adopt]);

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-medium text-ink">{name}</span>
        <span className="text-xs uppercase tracking-wider text-muted">{describe(status)}</span>
        {status === "conflict" && (
          <button
            type="button"
            onClick={takeDisk}
            className="upstream-flash cursor-pointer rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider"
          >
            File changed on disk — load it
          </button>
        )}
        {note && <span className="truncate text-xs text-muted">{note}</span>}
      </header>
      <div ref={host} className="min-h-0 flex-1 overflow-auto" />
    </div>
  );
}

function describe(status: Status): string {
  if (status === "loading") return "opening";
  if (status === "dirty") return "unsaved";
  if (status === "saving") return "saving";
  if (status === "conflict") return "";
  if (status === "error") return "";
  return "saved";
}
