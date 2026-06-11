import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BibEntry } from "~/lib/citations";
import type { CitationController, CitationSuggestState } from "~/lib/citation-suggest";

function authorLabel(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors[0]} et al.`;
}

function entryLabel(entry: BibEntry): string {
  const a = authorLabel(entry.authors);
  return a ? `${a} (${entry.year})` : `(${entry.year})`;
}

/**
 * Floating list for the `@`-citation picker. Subscribes to the controller for
 * the active suggestion state and registers a key handler so the suggestion
 * plugin's arrow/enter keystrokes drive the selection in React.
 */
export default function CitationPopup({ controller }: { controller: CitationController }) {
  const [state, setState] = useState<CitationSuggestState | null>(null);
  const [selected, setSelected] = useState(0);
  const stateRef = useRef<CitationSuggestState | null>(null);
  const selectedRef = useRef(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(
    () =>
      controller.subscribe((next) => {
        setState(next);
        setSelected(0);
      }),
    [controller],
  );

  useEffect(() => {
    controller.setKeyHandler((event) => {
      const s = stateRef.current;
      if (!s || s.items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((i) => (i + 1) % s.items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((i) => (i - 1 + s.items.length) % s.items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        s.command(s.items[selectedRef.current]);
        return true;
      }
      return false;
    });
    return () => {
      controller.setKeyHandler(null);
    };
  }, [controller]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!state || state.items.length === 0 || typeof document === "undefined") return null;
  const rect = state.clientRect();
  if (!rect) return null;

  // Flip above the caret when there is little room below.
  const below = rect.bottom + 4;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceBelow < 280;

  // Portal to <body> so no overflow-hidden or transformed ancestor can clip or
  // re-root the fixed popup.
  return createPortal(
    <div
      className="fixed z-50 max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded border border-border bg-paper py-1 text-sm shadow-lg"
      style={
        placeAbove
          ? { left: rect.left, bottom: window.innerHeight - rect.top + 4 }
          : { left: rect.left, top: below }
      }
    >
      {state.items.map((item, i) => (
        <button
          key={item.key}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          // Use mousedown so the click lands before the editor loses focus.
          onMouseDown={(e) => {
            e.preventDefault();
            state.command(item);
          }}
          onMouseEnter={() => setSelected(i)}
          className={`block w-full px-3 py-1.5 text-left ${
            i === selected ? "bg-ink text-paper" : "text-ink"
          }`}
        >
          <div className="truncate font-medium">{entryLabel(item.entry)}</div>
          {item.entry.title && (
            <div
              className={`truncate text-xs ${i === selected ? "text-paper/70" : "text-ink/60"}`}
            >
              {item.entry.title}
            </div>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
