import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  snippet,
  snippetCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { searchScore } from "~/lib/fuzzy";

/**
 * Slash-command menu for the CodeMirror 6 / Y.Text core, ported from the slides
 * app's `Editor.jsx`. Type "/" at the start of a line (or after a space) to open
 * a menu that inserts common Quarto/Pandoc structures (columns, spans, fenced
 * divs, cards, panels, fragments, speaker notes, ...). Snippet `${name}` fields
 * are tab-navigable placeholders; `${}` is where the cursor lands at the end.
 *
 * Suggest mode (the editor default) wraps the first typed "/" into `{++/++}` and
 * extends that addition as you keep typing, exactly like the `@`-citation
 * picker. So the trigger guard below also accepts a "/" sitting right after a
 * CriticMarkup addition opener, and a snippet then expands inside the addition,
 * which reads as one suggested insertion that accepting cleans up.
 */

/**
 * Like snippetCompletion, but after expanding it reopens the menu at the cursor.
 * Used for snippets whose first field is an empty class slot (`{.${1}}`), so the
 * class picker appears at once and you pick a real style rather than typing over
 * a placeholder word.
 */
function classSnippet(template: string, info: Omit<Completion, "apply">): Completion {
  const apply = snippet(template);
  return {
    ...info,
    apply: (view, completion, from, to) => {
      apply(view, completion, from, to);
      startCompletion(view);
    },
  };
}

const SLASH_COMMANDS: Completion[] = [
  // Opens the library gallery (drop in a standard slide or image) rather than
  // inserting a snippet: removes the typed "/library" then fires the toggle event.
  {
    label: "/library",
    detail: "insert a standard slide or image from the library",
    type: "keyword",
    boost: 100,
    apply: (view, _completion, from, to) => {
      view.dispatch({ changes: { from, to, insert: "" } });
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mist-toggle-library"));
    },
  },
  snippetCompletion(
    ':::: {.columns}\n\n::: {.column width="50%"}\n${1}\n:::\n\n::: {.column width="50%"}\n${2}\n:::\n\n::::\n\n${}',
    { label: "/columns", detail: "two columns (50/50)", type: "keyword", boost: 99 },
  ),
  snippetCompletion(
    '::: {.column width="${1:50}%"}\n\n${2}\n\n:::\n\n${}',
    { label: "/column", detail: "single column block", type: "keyword", boost: 98 },
  ),
  classSnippet("[${2:text}]{.${1}}${}", {
    label: "/span",
    detail: "inline span [text]{.class}",
    type: "keyword",
    boost: 97,
  }),
  // Inserts the fill prefix `.bg-` then reopens the picker filtered to the
  // `.bg-<colour>` fills, so the box fills with a colour but the text stays
  // readable (ink on a pale tint; add .solid for a strong fill).
  classSnippet("::: {.bg-${1}}\n\n${2}\n\n:::\n\n${}", {
    label: "/box",
    detail: "a tinted box: pick a fill colour (add .solid for a strong fill)",
    type: "keyword",
    boost: 96,
  }),
  snippetCompletion(
    "::: {.cards}\n\n- ${1}\n- ${2}\n\n:::\n\n${}",
    { label: "/cards", detail: "grid of cards (one per list item)", type: "keyword", boost: 92 },
  ),
  snippetCompletion("::: {.card}\n\n${1}\n\n:::\n\n${}", {
    label: "/card",
    detail: "one card (add a colour to tint it)",
    type: "keyword",
    boost: 91,
  }),
  snippetCompletion("::: {.callout .callout-${1:note}}\n\n${2}\n\n:::\n\n${}", {
    label: "/callout",
    detail: "callout box (note/tip/warning/important)",
    type: "keyword",
    boost: 90,
  }),
  snippetCompletion(
    "::: {.bignums}\n\n- **${1}** ${2}\n- **${3}** ${4}\n\n:::\n\n${}",
    { label: "/bignums", detail: "list of big figures (bold figure, then a note)", type: "keyword", boost: 45 },
  ),
  snippetCompletion("[${1:footer text}]{.footer}${}", {
    label: "/footer",
    detail: "small dimmed footer line",
    type: "keyword",
    boost: 44,
  }),
  snippetCompletion(
    '::: {.place style="top:${1:50}%; left:${2:50}%"}\n\n${3}\n\n:::\n\n${}',
    { label: "/place", detail: "float a block anywhere (top/left %)", type: "keyword", boost: 51 },
  ),
  // Component + colour: inserts the component class then opens the picker for the
  // colour (you then add .light/.dark or .cascade-2 by typing another `.`).
  classSnippet("::: {.panel .${1}}\n\n${2:content}\n\n:::\n\n${}", {
    label: "/panel",
    detail: "panel box, then pick a colour",
    type: "keyword",
    boost: 94,
  }),
  classSnippet("[${2:text}]{.hl .${1}}${}", {
    label: "/highlight",
    detail: "static highlight, then pick a colour",
    type: "keyword",
    boost: 93,
  }),
  classSnippet("[${2:text}]{.flare .${1}}${}", {
    label: "/flare",
    detail: "animated highlight, then pick a colour",
    type: "keyword",
    boost: 93,
  }),
  snippetCompletion(
    ':::: {.columns}\n\n::: {.column width="33%"}\n${1}\n:::\n\n::: {.column width="33%"}\n${2}\n:::\n\n::: {.column width="33%"}\n${3}\n:::\n\n::::\n\n${}',
    { label: "/columns3", detail: "three columns (33% each)", type: "keyword", boost: 50 },
  ),
  snippetCompletion("::: {.fragment}\n\n${1}\n\n:::\n\n${}", {
    label: "/fragment",
    detail: "reveal one step at a time",
    type: "keyword",
    boost: 49,
  }),
  snippetCompletion("::: {.incremental}\n\n- ${1}\n- ${2}\n\n:::\n\n${}", {
    label: "/incremental",
    detail: "reveal list items one at a time",
    type: "keyword",
    boost: 48,
  }),
  snippetCompletion("::: {.notes}\n\n${1}\n\n:::\n\n${}", {
    label: "/notes",
    detail: "speaker notes: off the slide, shown in the speaker view (S on the full deck)",
    type: "keyword",
    boost: 48,
  }),
  snippetCompletion("![${alt}](${url})${}", {
    label: "/image",
    detail: "insert an image by URL or path (or just paste one)",
    type: "keyword",
    boost: 47,
  }),
  // Outline shapes: opens the colour picker for the outline (skip it for the
  // default red), then tab through the exact top/left % (edit for precise
  // placement) to an optional centred label. Resize with .scale- or width/height.
  classSnippet('::: {.rectangle .${1} .place .scale-75 style="top:${2:40}%; left:${3:40}%"}\n\n${4}\n\n:::\n\n${}', {
    label: "/rectangle",
    detail: "outline rectangle: colour, exact top/left %, label",
    type: "keyword",
    boost: 40,
  }),
  classSnippet('::: {.circle .${1} .place .scale-75 style="top:${2:40}%; left:${3:40}%"}\n\n${4}\n\n:::\n\n${}', {
    label: "/circle",
    detail: "outline circle: colour, exact top/left %, label",
    type: "keyword",
    boost: 40,
  }),
  classSnippet('::: {.oval .${1} .place .scale-75 style="top:${2:40}%; left:${3:40}%"}\n\n${4}\n\n:::\n\n${}', {
    label: "/oval",
    detail: "outline oval: colour, exact top/left %, label",
    type: "keyword",
    boost: 40,
  }),
  // Not a snippet: removes the fenced div around the cursor (opener + matching
  // closer), keeping the content. See unwrapDivAtCursor.
  {
    label: "/unwrap",
    detail: "remove the surrounding div, keep its content",
    type: "keyword",
    boost: 46,
    apply: (view, _completion, from, to) => unwrapDivAtCursor(view, from, to),
  },
];

/** The slash commands as plain `{ cmd, detail }` rows for the help panel, so the
 *  reference and the live menu cannot drift (one source of truth). */
export const SLASH_HELP: { cmd: string; detail: string }[] = SLASH_COMMANDS.map((c) => ({
  cmd: c.label ?? "",
  detail: c.detail ?? "",
}));

/**
 * Slash completion source. Add to the editor's `autocompletion` override
 * alongside the citation and class sources.
 */
export function slashSource(): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/\/[\w-]*$/);
    if (!match) return null;
    // Only trigger at line start, after whitespace, or right after a CriticMarkup
    // addition opener `{++` (suggest mode), so URLs (http://) stay quiet.
    if (match.from > 0) {
      const prev = ctx.state.sliceDoc(match.from - 1, match.from);
      const opener = ctx.state.sliceDoc(Math.max(0, match.from - 3), match.from);
      if (!/\s/.test(prev) && opener !== "{++") return null;
    }
    // With no query, list everything in boost order. Once typing, search the
    // command name AND its description, with a direct name hit weighted above a
    // description-only hit (searchScore). filter:false so our order stands; no
    // validFor so the source re-scores on each keystroke rather than letting
    // CodeMirror re-filter on the label alone.
    const q = match.text.slice(1).toLowerCase();
    if (!q) return { from: match.from, options: SLASH_COMMANDS };
    const scored: { score: number; boost: number; opt: Completion }[] = [];
    for (const opt of SLASH_COMMANDS) {
      const name = (opt.label ?? "").replace(/^\//, "");
      const score = searchScore(q, name, opt.detail ?? "");
      if (score == null) continue;
      scored.push({ score, boost: opt.boost ?? 0, opt });
    }
    scored.sort((a, b) => b.score - a.score || b.boost - a.boost);
    return { from: match.from, options: scored.map((s) => s.opt), filter: false };
  };
}

/**
 * Typing "/" over a non-empty selection wraps it instead of replacing: a
 * single-line selection becomes an inline span `[selection]{.}`, a multi-line
 * one is rounded out to whole lines and wrapped in a fenced div, then the class
 * picker opens. With no selection this returns false so "/" types through to the
 * slash menu. The "input.wrap" user event keeps suggest mode from wrapping it.
 */
export const slashWrapSelection = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "/" || from === to) return false;
  const doc = view.state.doc;
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);

  if (startLine.number !== endLine.number) {
    const body = view.state.sliceDoc(startLine.from, endLine.to);
    // Wrap in a fenced div with the fill prefix `.bg-`, cursor right after it, so
    // the class picker opens filtered to the `.bg-<colour>` fills (readable text
    // on a tint). Picking one completes the class.
    const insert = `::: {.bg-}\n${body}\n:::`;
    const caret = startLine.from + "::: {.bg-".length;
    view.dispatch({
      changes: { from: startLine.from, to: endLine.to, insert },
      selection: { anchor: caret },
      userEvent: "input.wrap",
    });
    startCompletion(view);
    return true;
  }

  const selected = view.state.sliceDoc(from, to);
  const insert = `[${selected}]{.}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - 1 }, // between "." and "}"
    userEvent: "input.wrap",
  });
  startCompletion(view);
  return true;
});

// Pandoc fenced-div lines: an opener carries content after the colons
// (`::: {.foo}` or `::: foo`); a closer is bare colons.
const isOpenFence = (t: string) => /^\s*:{3,}\s*\S/.test(t);
const isCloseFence = (t: string) => /^\s*:{3,}\s*$/.test(t);

/** Innermost fenced div whose line range contains `lineNumber`. A stack pairs
 *  openers to closers so nesting resolves correctly. */
function findEnclosingDiv(doc: EditorView["state"]["doc"], lineNumber: number) {
  const stack: number[] = [];
  let best: { open: number; close: number } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const t = doc.line(n).text;
    if (isCloseFence(t)) {
      const open = stack.pop();
      if (open != null && open <= lineNumber && lineNumber <= n && (!best || open > best.open)) {
        best = { open, close: n };
      }
    } else if (isOpenFence(t)) {
      stack.push(n);
    }
  }
  return best;
}

/**
 * Remove the fenced div surrounding the cursor, keeping its content. Strips the
 * typed trigger first (and any CriticMarkup addition wrapper suggest mode put
 * around it), then deletes the opening and matching closing fence lines. The
 * "input.wrap" user event keeps suggest mode from re-wrapping the deletions.
 */
function unwrapDivAtCursor(view: EditorView, from: number, to: number) {
  // Swallow a `{++ ++}` wrapper left around the trigger by suggest mode.
  let start = from;
  let end = to;
  if (view.state.sliceDoc(start - 3, start) === "{++" && view.state.sliceDoc(end, end + 3) === "++}") {
    start -= 3;
    end += 3;
  }
  view.dispatch({ changes: { from: start, to: end, insert: "" }, selection: { anchor: start }, userEvent: "input.wrap" });

  const doc = view.state.doc;
  const cursorLine = doc.lineAt(start).number;
  const div = findEnclosingDiv(doc, cursorLine);
  if (!div) return;
  const openLine = doc.line(div.open);
  const closeLine = doc.line(div.close);
  // Delete each fence line plus its trailing newline; closer first to keep the
  // opener's offsets valid.
  const lineSpan = (ln: typeof openLine) => ({
    from: ln.from,
    to: ln.number < doc.lines ? doc.line(ln.number + 1).from : ln.to,
  });
  view.dispatch({
    changes: [lineSpan(closeLine), lineSpan(openLine)].map((s) => ({ ...s, insert: "" })),
    userEvent: "input.wrap",
  });
}
