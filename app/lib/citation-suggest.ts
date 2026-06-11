// `@`-triggered citation picker. Reuses the parsed BibTeX library (see
// `citations.ts`) to offer a searchable reference list, inserting Pandoc
// `[@key]` text that Preview already renders to APA. In suggest mode the
// inserted citation is wrapped in a criticAddition mark so it shows as a
// tracked suggestion, mirroring `suggest-mode.ts`.

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { TextSelection } from "@tiptap/pm/state";
import type { BibEntry, BibLibrary } from "~/lib/citations";

export interface CitationItem {
  key: string;
  entry: BibEntry;
}

/** Live state pushed from the suggestion plugin to the React popup. */
export interface CitationSuggestState {
  items: CitationItem[];
  command: (item: CitationItem) => void;
  clientRect: () => DOMRect | null;
}

/**
 * Bridge between the ProseMirror suggestion plugin and the React popup: the
 * plugin emits state and forwards keystrokes; the popup subscribes and registers
 * a key handler so arrow/enter selection stays in React.
 */
export interface CitationController {
  subscribe: (fn: (state: CitationSuggestState | null) => void) => () => void;
  emit: (state: CitationSuggestState | null) => void;
  setKeyHandler: (fn: ((event: KeyboardEvent) => boolean) | null) => void;
  handleKey: (event: KeyboardEvent) => boolean;
  // Live editor context, set from React via effects so the extension reads it
  // without React refs crossing the boundary.
  setLibrary: (lib: BibLibrary | null) => void;
  getLibrary: () => BibLibrary | null;
  setModeGetter: (fn: () => string) => void;
  getMode: () => string;
}

export function createCitationController(): CitationController {
  const listeners = new Set<(state: CitationSuggestState | null) => void>();
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  let library: BibLibrary | null = null;
  let modeGetter: () => string = () => "suggest";
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(state) {
      for (const fn of listeners) fn(state);
    },
    setKeyHandler(fn) {
      keyHandler = fn;
    },
    handleKey(event) {
      return keyHandler ? keyHandler(event) : false;
    },
    setLibrary(lib) {
      library = lib;
    },
    getLibrary() {
      return library;
    },
    setModeGetter(fn) {
      modeGetter = fn;
    },
    getMode() {
      return modeGetter();
    },
  };
}

export interface CitationSuggestOptions {
  controller: CitationController | null;
}

const MAX_RESULTS = 50;

export const CitationSuggest = Extension.create<CitationSuggestOptions>({
  name: "citationSuggest",

  addOptions() {
    return {
      controller: null,
    };
  },

  addProseMirrorPlugins() {
    const { controller } = this.options;
    if (!controller) return [];
    const getLibrary = () => controller.getLibrary();
    const getMode = () => controller.getMode();

    return [
      Suggestion<CitationItem>({
        editor: this.editor,
        char: "@",
        allowSpaces: false,
        // Only fire where a bare/bracketed citation could go: start of a word.
        // Matches the bare-citation rule in citations.ts (no leading word char).
        allow: () => !!getLibrary(),

        items: ({ query }) => {
          const lib = getLibrary();
          if (!lib) return [];
          const q = query.trim().toLowerCase();
          const out: CitationItem[] = [];
          for (const [key, entry] of lib) {
            if (q) {
              const hay = `${key} ${entry.authors.join(" ")} ${entry.title ?? ""} ${entry.year}`.toLowerCase();
              if (!hay.includes(q)) continue;
            }
            out.push({ key, entry });
            if (out.length >= MAX_RESULTS) break;
          }
          return out;
        },

        command: ({ editor, range, props }) => {
          const text = `[@${props.key}]`;
          const { state, view } = editor;
          const addition = state.schema.marks.criticAddition;
          const tr = state.tr;
          tr.insertText(text, range.from, range.to);
          const end = range.from + text.length;
          // In suggest mode the picker bypasses handleTextInput, so mark the
          // inserted citation as an addition ourselves.
          if (getMode() === "suggest" && addition) {
            tr.addMark(range.from, end, addition.create());
          }
          tr.setSelection(TextSelection.near(tr.doc.resolve(end)));
          view.dispatch(tr);
          view.focus();
        },

        render: () => {
          const push = (props: {
            items: CitationItem[];
            command: (item: CitationItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) => {
            controller.emit({
              items: props.items,
              command: props.command,
              clientRect: props.clientRect ?? (() => null),
            });
          };
          return {
            onStart: push,
            onUpdate: push,
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                controller.emit(null);
                return true;
              }
              return controller.handleKey(event);
            },
            onExit: () => controller.emit(null),
          };
        },
      }),
    ];
  },
});
