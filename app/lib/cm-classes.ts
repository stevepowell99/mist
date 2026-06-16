import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import CATALOGUE from "~/styles/classes.json";

/** Per-class group + one-line description, derived from the framework manifest
 *  (classes.json), so the picker is self-explanatory and stays in step with the
 *  CSS. Generated step utilities (.scale-*, .top-* …) are expanded from the
 *  manifest's step/values definitions. */
type ClassInfo = { section: string; detail: string };
const SECTION_LABEL: Record<string, string> = {
  component: "Component", colour: "Colour", shade: "Shade", scale: "Scale",
  order: "Order", timing: "Timing", align: "Align", place: "Place",
};
const SECTION_RANK: Record<string, number> = {
  Component: 1, Colour: 2, Scale: 3, Shade: 4, Timing: 5, Align: 6, Order: 7,
  Place: 8, "Reveal/Quarto": 9, "Deck CSS": 10,
};

const CLASS_INFO: Record<string, ClassInfo> = (() => {
  const m: Record<string, ClassInfo> = {};
  const cat = CATALOGUE as {
    axes?: Record<string, { desc?: string; classes?: Record<string, string>; generated?: Record<string, unknown> }>;
    external?: { classes?: string[] };
  };
  for (const [key, axis] of Object.entries(cat.axes ?? {})) {
    const section = SECTION_LABEL[key] ?? key;
    const fallback = section.toLowerCase();
    if (axis.classes) {
      for (const [name, desc] of Object.entries(axis.classes)) {
        m[name] = { section, detail: desc?.trim() || fallback };
      }
    }
    const g = axis.generated as
      | { prefix?: string | string[]; unit?: string; values?: number[]; step?: number; from?: number; to?: number }
      | undefined;
    if (g) {
      const prefixes = Array.isArray(g.prefix) ? g.prefix : [g.prefix ?? ""];
      const unit = g.unit && g.unit !== "ratio" ? g.unit : "";
      if (g.values) {
        for (const p of prefixes) for (const v of g.values) {
          m[`${p}-${v}`] = { section, detail: g.unit === "ratio" ? `${v}% size` : `${p}: ${v}${unit}` };
        }
      } else if (g.step != null) {
        for (const p of prefixes) for (let v = g.from ?? 0; v <= (g.to ?? 0); v += g.step) {
          m[`${p}-${v}`] = { section, detail: `${p}: ${v}${unit || "%"}` };
        }
      }
    }
  }
  for (const name of cat.external?.classes ?? []) m[name] = { section: "Reveal/Quarto", detail: "" };
  return m;
})();

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
      const info = CLASS_INFO[c];
      const sectionName = info?.section ?? (BUILTIN_CLASSES.includes(c) ? "Reveal/Quarto" : "Deck CSS");
      options.push({
        label: `.${c}`,
        apply: `.${c}`,
        type: "class",
        detail: info?.detail || undefined,
        section: { name: sectionName, rank: SECTION_RANK[sectionName] ?? 99 },
      });
      if (options.length >= 80) break;
    }
    if (!options.length) return null;
    return { from: token.from, options, filter: false };
  };
}
