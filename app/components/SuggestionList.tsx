import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { listSuggestions, resolveAtCursor, resolveAll, type SuggestionItem } from "~/lib/cm-suggestion-actions";

/**
 * The suggested edits, listed like the comments beside them, so reviewing a
 * document is one panel: each edit shows what it removes and adds and carries
 * its own Accept/Reject, and clicking it scrolls the editor to the markup. The
 * old panel offered only "accept the suggestion at the cursor", which meant the
 * user had to find and click the edit in the text first, which nothing said.
 * Edit-link users only: accepting applies a change.
 */

const LABEL: Record<SuggestionItem["type"], string> = {
  addition: "Insert",
  deletion: "Delete",
  substitution: "Replace",
};

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export default function SuggestionList() {
  const { view, markdown, mode, role, cursorOffset } = useDocument();
  const items = useMemo(() => listSuggestions(markdown), [markdown]);

  const resolve = useCallback(
    (item: SuggestionItem, accept: boolean) => {
      if (!view) return;
      const change = resolveAtCursor(view.state.doc.toString(), item.from, accept);
      if (change) view.dispatch({ changes: change, userEvent: "input.accept" });
      view.focus();
    },
    [view],
  );

  const all = useCallback(
    (accept: boolean) => {
      if (!view) return;
      const changes = resolveAll(view.state.doc.toString(), accept);
      if (changes.length) view.dispatch({ changes, userEvent: "input.accept" });
      view.focus();
    },
    [view],
  );

  const jump = useCallback(
    (item: SuggestionItem) => {
      if (!view) return;
      view.dispatch({ selection: { anchor: item.from }, scrollIntoView: true });
      view.focus();
    },
    [view],
  );

  // Accepting or rejecting applies edits, so only edit-link users see these.
  if (role !== "edit") return null;
  if (!items.length) {
    if (mode !== "suggest") return null;
    return (
      <div className="px-3 py-2 text-sm text-muted">
        Suggest mode: select text in the editor to delete, replace or insert. Your edits appear here
        for the owner to accept.
      </div>
    );
  }

  const btn =
    "flex-1 cursor-pointer border border-border px-2 py-1 text-sm uppercase tracking-wider transition-colors hover:bg-border";

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm uppercase tracking-wider text-muted">
          Edits ({items.length})
        </span>
        <div className="flex gap-1">
          <button onClick={() => all(true)} className={`${btn} text-muted`}>
            Accept all
          </button>
          <button onClick={() => all(false)} className={`${btn} text-muted`}>
            Reject all
          </button>
        </div>
      </div>

      {items.map((item) => (
        <SuggestionCard
          key={`${item.from}-${item.to}`}
          item={item}
          active={cursorOffset >= item.from && cursorOffset <= item.to}
          onJump={jump}
          onResolve={resolve}
        />
      ))}
    </div>
  );
}

function SuggestionCard({
  item,
  active,
  onJump,
  onResolve,
}: {
  item: SuggestionItem;
  active: boolean;
  onJump: (item: SuggestionItem) => void;
  onResolve: (item: SuggestionItem, accept: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Track the editor, as the comment panels do: the edit under the cursor brings
  // itself into view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      onClick={() => onJump(item)}
      className={`cursor-pointer border-b border-border p-3 ${active ? "bg-canary/15" : ""}`}
    >
      <div className="text-sm uppercase tracking-wider text-muted">{LABEL[item.type]}</div>
      <div className="mt-1 text-base">
        {item.removed && <span className="cm-deletion">{truncate(item.removed)}</span>}
        {item.removed && item.added && " "}
        {item.added && <span className="cm-addition">{truncate(item.added)}</span>}
      </div>
      <div className="mt-2 flex border border-border" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onResolve(item, true)}
          className="flex-1 cursor-pointer px-2.5 py-1.5 text-sm uppercase tracking-wider text-green-600 transition-colors hover:bg-border"
        >
          Accept
        </button>
        <button
          onClick={() => onResolve(item, false)}
          className="flex-1 cursor-pointer border-l border-border px-2.5 py-1.5 text-sm uppercase tracking-wider text-red-500 transition-colors hover:bg-border"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
