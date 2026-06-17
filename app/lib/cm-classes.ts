import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import CATALOGUE from "~/styles/classes.json";
import { searchScore } from "~/lib/fuzzy";

/** Per-class group + one-line description, derived from the framework manifest
 *  (classes.json), so the picker is self-explanatory and stays in step with the
 *  CSS. Generated step utilities (.scale-*, .top-* …) are expanded from the
 *  manifest's step/values definitions. */
type ClassInfo = { section: string; detail: string };
const SECTION_LABEL: Record<string, string> = {
  component: "Component", colour: "Colour", fill: "Fill", border: "Border",
  shade: "Shade", scale: "Scale", order: "Order", timing: "Timing",
  align: "Align", place: "Place", width: "Size", height: "Size",
};
const SECTION_RANK: Record<string, number> = {
  Component: 1, Colour: 2, Fill: 2.3, Border: 2.6, Scale: 3, Size: 3.5, Shade: 4,
  Timing: 5, Align: 6, Order: 7, Place: 8, "Reveal/Quarto": 9, "Deck CSS": 10,
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
      | { prefix?: string | string[]; unit?: string; values?: number[]; step?: number; from?: number; to?: number; suffixesFrom?: string; detail?: string }
      | undefined;
    if (g) {
      const prefixes = Array.isArray(g.prefix) ? g.prefix : [g.prefix ?? ""];
      const unit = g.unit && g.unit !== "ratio" ? g.unit : "";
      if (g.suffixesFrom) {
        // String-suffix cross product, e.g. .bg-<colour> / .border-<colour>: pull
        // the suffix list from another axis (the colour names) so it stays DRY.
        const suffixes = Object.keys(cat.axes?.[g.suffixesFrom]?.classes ?? {});
        const tmpl = g.detail ?? "$suffix";
        for (const p of prefixes) for (const s of suffixes) {
          const label = s.charAt(0).toUpperCase() + s.slice(1);
          m[`${p}-${s}`] = { section, detail: tmpl.replace("$suffix", label) };
        }
      } else if (g.values) {
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
 *  and friends are available everywhere, each with a one-line description so the
 *  picker is self-explanatory for these too. */
const BUILTIN_CLASSES: Record<string, string> = {
  // reveal fragments (incremental reveal + effects)
  fragment: "Reveal on click (incremental)",
  "fade-in": "Fragment: fade in",
  "fade-out": "Fragment: fade out",
  "fade-up": "Fragment: fade in, rise up",
  "fade-down": "Fragment: fade in, drop down",
  "fade-left": "Fragment: fade in from the right",
  "fade-right": "Fragment: fade in from the left",
  "fade-in-then-out": "Fragment: in, then out next step",
  "fade-in-then-semi-out": "Fragment: in, then dim",
  "semi-fade-out": "Fragment: dim on next step",
  "current-visible": "Fragment: shown on its step only",
  grow: "Fragment: scale up",
  shrink: "Fragment: scale down",
  strike: "Fragment: strike through",
  "highlight-red": "Fragment: turn red",
  "highlight-green": "Fragment: turn green",
  "highlight-blue": "Fragment: turn blue",
  "highlight-current-red": "Fragment: red on its step",
  "highlight-current-green": "Fragment: green on its step",
  "highlight-current-blue": "Fragment: blue on its step",
  // quarto / reveal layout + text helpers
  columns: "Row of side-by-side columns (each child is a column; set width= for an uneven split)",
  incremental: "Quarto: reveal items one by one",
  nonincremental: "Quarto: reveal all at once",
  smaller: "Quarto: smaller slide text",
  center: "Centre slide content",
  "r-fit-text": "Reveal: scale text to fill",
  "r-stretch": "Reveal: stretch media to fit",
  "r-frame": "Reveal: framed border",
  nostretch: "Opt out of r-stretch",
  "callout-note": "Note callout (blue)",
  "callout-tip": "Tip callout (green)",
  "callout-warning": "Warning callout (yellow)",
  "callout-important": "Important callout (pink)",
  "callout-caution": "Caution callout (yellow)",
};

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
    const classes = [...new Set([...getClasses(), ...Object.keys(BUILTIN_CLASSES)])];
    if (!classes.length) return null;
    const q = token.text.slice(1).toLowerCase();
    // Fuzzy match the class name (subsequence) AND keyword-search the
    // description, so `.pnl` finds `.panel` and `.highlight` finds `.hl`/`.flare`
    // by what they DO. A direct name hit always outranks a description-only hit
    // (searchScore). While querying we drop the section grouping so that weighting
    // actually orders the list; with no query we keep sections for browsing.
    const scored: { score: number; opt: Completion }[] = [];
    for (const c of classes) {
      const info = CLASS_INFO[c];
      const detail = info?.detail || BUILTIN_CLASSES[c] || "";
      const score = searchScore(q, c, detail);
      if (score == null) continue;
      const sectionName = info?.section ?? (c in BUILTIN_CLASSES ? "Reveal/Quarto" : "Deck CSS");
      scored.push({
        score,
        opt: {
          label: `.${c}`,
          apply: `.${c}`,
          type: "class",
          detail: detail || undefined,
          section: q ? undefined : { name: sectionName, rank: SECTION_RANK[sectionName] ?? 99 },
        },
      });
    }
    if (!scored.length) return null;
    if (q) scored.sort((a, b) => b.score - a.score);
    const options = scored.slice(0, 120).map((s) => s.opt);
    return { from: token.from, options, filter: false };
  };
}
