import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { ICON_NAMES, renderIcon } from "~/lib/icons";

/**
 * `:name:` icon picker for the editor. Typing `:` after a space opens a list of
 * the curated icons (app/lib/icons.ts); picking one inserts `:name:`, which the
 * grammar renders to an inline SVG. Gated to a `:` that follows a literal space,
 * so it never fires at a line start (the `:::` fences), in `http://` or a time
 * like `12:30`. Each option previews its glyph in the info panel.
 */
export function iconSource(): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const token = ctx.matchBefore(/:[a-z0-9-]*/);
    if (!token) return null;
    if (token.from === 0) return null; // line start: leave the ::: fences alone
    if (ctx.state.sliceDoc(token.from - 1, token.from) !== " ") return null;

    const q = token.text.slice(1).toLowerCase();
    const names = ICON_NAMES.filter((n) => !q || n.includes(q));
    if (!names.length) return null;
    // A name that starts with the query first, then the rest alphabetically.
    names.sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)) || a.localeCompare(b));

    const options: Completion[] = names.map((n) => ({
      label: `:${n}:`,
      apply: `:${n}:`,
      type: "keyword",
      info: () => {
        const span = document.createElement("span");
        span.innerHTML = renderIcon(n);
        const svg = span.firstElementChild as SVGElement | null;
        if (svg) {
          svg.style.width = "28px";
          svg.style.height = "28px";
        }
        return span;
      },
    }));
    return { from: token.from, options, filter: false };
  };
}
