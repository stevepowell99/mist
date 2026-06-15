import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { BibLibrary } from "./citations";

/**
 * `@`-citation picker for the CodeMirror 6 / Y.Text core (#13). Typing `@`
 * opens a list of the document's bibliography entries (author, year, title),
 * filtered as you type, and inserts a Pandoc `[@key]` that Preview renders to
 * APA, matching the TipTap `citation-suggest.ts`. The library getter is read
 * live, so the picker reflects whatever bib the document has loaded.
 */
export function citations(getLibrary: () => BibLibrary | null) {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const token = ctx.matchBefore(/@[\p{L}\d:_-]*/u);
    if (!token || (token.from === token.to && !ctx.explicit)) return null;
    const lib = getLibrary();
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

  return autocompletion({ override: [source], icons: false });
}
