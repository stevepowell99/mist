import { useCallback, useMemo, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { extractOutlineFromText, toggleHiddenText, type OutlineItem } from "~/lib/outline";

/**
 * Header-only outline for the open document (CodeMirror / Y.Text core). For a
 * deck it lists the slide titles (level 1 and 2); for a document it lists
 * headings down to a chosen level. Clicking an item scrolls the editor to that
 * heading. For a deck each item also has a hide/unhide toggle that marks the
 * slide `visibility="hidden"`, so it drops out of the preview without deletion.
 */
export default function OutlinePanel({
  view,
  text,
  deck,
  canEdit,
  onClose,
}: {
  view: EditorView | null;
  text: string;
  deck: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [maxLevel, setMaxLevel] = useState(3);
  const items = useMemo(() => extractOutlineFromText(text), [text]);

  const jump = useCallback(
    (pos: number) => {
      if (!view) return;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    [view],
  );

  const toggleHidden = useCallback(
    (item: OutlineItem) => {
      if (!view || !canEdit) return;
      const line = view.state.doc.sliceString(item.pos, item.pos + item.len);
      view.dispatch({
        changes: { from: item.pos, to: item.pos + item.len, insert: toggleHiddenText(line) },
        userEvent: "input.hide",
      });
    },
    [view, canEdit],
  );

  const shown = deck ? items.filter((i) => i.level <= 2) : items.filter((i) => i.level <= maxLevel);

  return (
    <aside className="panel-slide-left hidden w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-paper lg:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm uppercase tracking-wider text-muted">{deck ? "Slides" : "Outline"}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close outline"
          className="cursor-pointer px-1 text-lg leading-none text-muted hover:text-ink"
        >
          &times;
        </button>
      </div>
      {!deck && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5 text-xs text-muted">
          <span>Levels</span>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMaxLevel(n)}
              className={`cursor-pointer rounded px-1.5 ${maxLevel === n ? "bg-ink text-paper" : "hover:bg-border"}`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {shown.length === 0 && <p className="px-3 py-2 text-sm text-muted">No headings.</p>}
        {shown.map((item, i) => (
          <div
            key={`${item.pos}-${i}`}
            className={`group flex items-center gap-1 pr-1 ${item.hidden ? "opacity-45" : ""}`}
            style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.9}rem` }}
          >
            <button
              type="button"
              onClick={() => jump(item.pos)}
              title={item.title}
              className={`flex-1 truncate py-1 text-left text-sm hover:text-coral ${item.level === 1 ? "font-semibold" : ""} ${item.hidden ? "line-through" : ""}`}
            >
              {item.title}
            </button>
            {deck && canEdit && (
              <button
                type="button"
                onClick={() => toggleHidden(item)}
                title={item.hidden ? "Show slide" : "Hide slide"}
                aria-label={item.hidden ? "Show slide" : "Hide slide"}
                className="shrink-0 cursor-pointer p-1 text-muted opacity-0 hover:text-ink group-hover:opacity-100"
              >
                {item.hidden ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
