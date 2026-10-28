import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import type { BibLibrary } from "./citations";

/** Hand the editor the document's BibTeX library, which arrives by fetch after
 *  the editor is built and changes when the frontmatter's `bibliography:` does. */
export const setBib = StateEffect.define<BibLibrary | null>();

/**
 * The document's BibTeX library, held in the editor state so every consumer
 * reads one copy: the `@`-picker below and the live preview's citations, inline
 * and on rendered slides. Because it is state, a library that lands after the
 * first render is itself a transaction, and the live layer rebuilds on it like
 * any other change rather than waiting for the next keystroke.
 */
export const bibField = StateField.define<BibLibrary | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBib)) value = e.value;
    return value;
  },
});

/** The library, or null when the editor has none or was built without the field. */
export function bibOf(state: EditorState): BibLibrary | null {
  return state.field(bibField, false) ?? null;
}

/**
 * `@`-citation picker for the CodeMirror 6 / Y.Text core (#13). Typing `@`
 * opens a list of the document's bibliography entries (author, year, title),
 * filtered as you type, and inserts a Pandoc `[@key]` that Preview renders to
 * APA, matching the TipTap `citation-suggest.ts`. The library is read from
 * `bibField` at completion time, so the picker reflects whatever bib the
 * document has loaded. Exported as a source so it can share one autocompletion
 * config with the class picker.
 */
export function citationSource(): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const token = ctx.matchBefore(/@[\p{L}\d:_-]*/u);
    if (!token || (token.from === token.to && !ctx.explicit)) return null;
    const lib = bibOf(ctx.state);
    if (!lib || lib.size === 0) return null;

    const q = token.text.slice(1).toLowerCase();
    const options: Completion[] = [];
    for (const [key, entry] of lib) {
      const hay = `${key} ${entry.authors.join(" ")} ${entry.title ?? ""} ${entry.year}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const who = entry.authors[0] ?? key;
      const detail = entry.title ? `${who} ${entry.year}, ${entry.title}` : `${who} ${entry.year}`;
      options.push({ label: `@${key}`, detail, apply: `[@${key}]` });
      if (options.length >= 50) break;
    }
    if (options.length === 0) return null;
    return { from: token.from, options, filter: false };
  };
}
