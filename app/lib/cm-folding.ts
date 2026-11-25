import { foldEffect, foldService } from "@codemirror/language";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorState, Text, Transaction } from "@codemirror/state";
import { closeTagEnd } from "./html-tags";
import { MERMAID_START } from "./mermaid";

/**
 * Folding for the markdown editor, in every View (Editor, Split and Live) of
 * both the room editor and the local one. A fold hides from the end of its
 * opening line to the end of its closing line.
 *
 * The fold gutter collapses the YAML frontmatter, Quarto `::: {.class}` fenced
 * divs and a drawing element (an inline `<svg>`, a `<style>` or `<script>`
 * block) here; headings, code fences, tables and HTML blocks fold through the
 * markdown language itself. The drawing rule is here as well because the parser
 * ends an HTML block at its first blank line or treats it as paragraph text
 * after a `:::` line, so it would fold only part of an SVG, or none of it.
 *
 * Drawing code is also folded by default: when the text is loaded, every inline
 * SVG, style or script block and every diagram fence (`drawingFolds`) starts
 * collapsed, except one the selection is in. It is markup for the picture, not
 * text to read, and a single diagram can be longer than the prose around it.
 */
const FENCE = /^\s*(:{3,})(.*)$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** An element that draws or styles rather than being read. */
const DRAWING_TAG = /^\s*<(svg|style|script)(?=[\s>/]|$)/i;
/** A fence in a diagram language. Mermaid is also recognised by its content,
 *  as the preview and live preview recognise it. */
const DIAGRAM_LANG = /^\{?\s*(?:mermaid|dot|graphviz)\b/i;

interface Range {
  from: number;
  to: number;
}

/** The fold for a drawing element whose open tag starts line `n`, when it
 *  closes on a later line. */
function tagFold(doc: Text, n: number): Range | null {
  const line = doc.line(n);
  const tag = DRAWING_TAG.exec(line.text);
  if (!tag) return null;
  const end = closeTagEnd(doc.sliceString(line.from), 0, tag[1]);
  if (end < 0) return null;
  const close = doc.lineAt(line.from + end);
  return close.number > n ? { from: line.to, to: close.to } : null;
}

/** For a code fence opening line `n`: its last line, and the fold when it is a
 *  diagram. An unclosed fence runs to the end and never folds, since it is
 *  being written. Null when line `n` opens no fence. */
function fenceAt(doc: Text, n: number): { fold: Range | null; last: number } | null {
  const line = doc.line(n);
  const open = CODE_FENCE.exec(line.text);
  if (!open) return null;
  const closer = new RegExp(`^ {0,3}${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}\\s*$`);
  for (let i = n + 1; i <= doc.lines; i++) {
    if (!closer.test(doc.line(i).text)) continue;
    if (i === n + 1) return { fold: null, last: i };
    const body = doc.sliceString(doc.line(n + 1).from, doc.line(i).from);
    const diagram = DIAGRAM_LANG.test(open[2].trim()) || MERMAID_START.test(body);
    return { fold: diagram ? { from: line.to, to: doc.line(i).to } : null, last: i };
  }
  return { fold: null, last: doc.lines };
}

/** Every drawing block in `doc` that folds by default: inline SVG, style and
 *  script blocks outside code, and diagram fences. In document order. */
export function drawingFolds(doc: Text): Range[] {
  const out: Range[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const fence = fenceAt(doc, n);
    if (fence) {
      if (fence.fold) out.push(fence.fold);
      n = fence.last;
      continue;
    }
    const tag = tagFold(doc, n);
    if (tag) {
      out.push(tag);
      n = doc.lineAt(tag.to).number;
    }
  }
  return out;
}

const foldable = foldService.of((state: EditorState, lineStart: number) => {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const text = line.text;

  // Frontmatter: the opening `---` on line 1 folds to its closing `---`.
  if (line.number === 1 && text.trim() === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === "---") return { from: line.to, to: doc.line(i).to };
    }
    return null;
  }

  // Fenced div: an opener (`:::` with content after) folds to its matching
  // closer, tracking nesting so the right `:::` is paired.
  const m = FENCE.exec(text);
  if (m && m[2].trim() !== "") {
    let depth = 1;
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const mm = FENCE.exec(doc.line(i).text);
      if (!mm) continue;
      if (mm[2].trim() === "") {
        depth--;
        if (depth === 0) return { from: line.to, to: doc.line(i).to };
      } else {
        depth++;
      }
    }
  }
  return tagFold(doc, line.number);
});

/** True when a transaction replaced the whole document, which is how text is
 *  loaded rather than typed: a room's first sync into an empty editor, a reload
 *  from disk. An insert into an empty document counts. */
function replacesAll(tr: Transaction): boolean {
  let all = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === tr.startState.doc.length) all = true;
  });
  return all;
}

/** Folds the drawing blocks when the editor opens on text, and again whenever
 *  the whole text is replaced. A fold once opened stays open until the next
 *  load, and a block the selection touches is never folded, since CodeMirror
 *  only unfolds under the cursor when the selection moves. */
const foldOnLoad = ViewPlugin.fromClass(
  class {
    dead = false;
    constructor(view: EditorView) {
      if (view.state.doc.length) this.fold(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged && u.transactions.some(replacesAll)) this.fold(u.view);
    }
    destroy() {
      this.dead = true;
    }
    fold(view: EditorView) {
      // A plugin may not dispatch inside an update, so this runs after it.
      queueMicrotask(() => {
        if (this.dead) return;
        const sel = view.state.selection.ranges;
        const effects = drawingFolds(view.state.doc)
          .filter((r) => !sel.some((s) => s.from <= r.to && s.to >= r.from))
          .map((r) => foldEffect.of(r));
        if (effects.length) view.dispatch({ effects });
      });
    }
  },
);

/** The editor's folds: what the gutter can collapse, and the drawing code that
 *  starts collapsed. Needs `codeFolding()` (or `foldGutter()`) beside it. */
export const mistFolds = [foldable, foldOnLoad];
