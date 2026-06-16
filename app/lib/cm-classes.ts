import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";

/**
 * Pandoc class picker for the editor, mirroring the slides app's helper: inside
 * a `{ ... }` attribute or on a `:::` fence line, typing `.` lists the classes
 * defined in the deck's own CSS (`.flare`, `.panel`, `.blue`, ...), filtered as
 * you type. The class list is read live from a getter, so it reflects whatever
 * stylesheet the document loaded.
 */
/** Class names defined in a stylesheet, e.g. `.flare`, `.blue`, deduped. Drops
 *  reveal/internal noise so the picker shows the deck's own composable classes. */
export function parseCssClasses(css: string): string[] {
  const seen = new Set<string>();
  for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    const name = m[1];
    // Skip reveal.js internals and state classes that are not authoring classes.
    if (/^(reveal|slides?|present|past|future|fragment|backgrounds?|controls|progress|r-)/.test(name)) continue;
    seen.add(name);
  }
  return [...seen].sort();
}

/** Reveal.js and Quarto authoring classes that are not in the deck's own CSS, so
 *  the deck-CSS parse never offers them. Merged into the picker so `.fragment`
 *  and friends are available everywhere. */
const BUILTIN_CLASSES = [
  // reveal fragments (incremental reveal + effects)
  "fragment", "fade-in", "fade-out", "fade-up", "fade-down", "fade-left", "fade-right",
  "fade-in-then-out", "fade-in-then-semi-out", "semi-fade-out", "current-visible",
  "grow", "shrink", "strike", "highlight-red", "highlight-green", "highlight-blue",
  "highlight-current-red", "highlight-current-green", "highlight-current-blue",
  // quarto / reveal layout + text helpers
  "columns", "column", "incremental", "nonincremental", "smaller", "center",
  "r-fit-text", "r-stretch", "r-frame", "nostretch",
  "callout-note", "callout-tip", "callout-warning", "callout-important", "callout-caution",
];

export function classSource(getClasses: () => string[]): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const token = ctx.matchBefore(/\.[\w-]*/);
    if (!token || (token.from === token.to && !ctx.explicit)) return null;

    // Only offer inside a Pandoc attribute: an open `{` before the cursor on
    // this line, or a `:::` fenced-div line. Keeps `.` in prose quiet.
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const inBraces = before.lastIndexOf("{") > before.lastIndexOf("}");
    const isFence = /^\s*:::/.test(line.text);
    if (!inBraces && !isFence) return null;

    // Deck-CSS classes first (the deck's own composable styles), then the
    // built-in reveal/Quarto authoring classes, deduped.
    const classes = [...new Set([...getClasses(), ...BUILTIN_CLASSES])];
    if (!classes.length) return null;
    const q = token.text.slice(1).toLowerCase();
    const options: Completion[] = [];
    for (const c of classes) {
      if (q && !c.toLowerCase().includes(q)) continue;
      options.push({ label: `.${c}`, apply: `.${c}`, type: "class" });
      if (options.length >= 60) break;
    }
    if (!options.length) return null;
    return { from: token.from, options, filter: false };
  };
}
