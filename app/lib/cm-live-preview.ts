import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { criticSpans } from "./critic";

/**
 * Live preview (the fourth View): the markdown syntax marks recede while you
 * write and come back on the line, or in the span, you are working on. The
 * document is untouched, as everywhere else in this editor: these are replace
 * decorations painted over the same `Y.Text` bytes, so save, sync, CriticMarkup
 * and the comment threads all see exactly what they saw before.
 *
 * The hide/reveal decision is the pure `hideRanges` below, so it tests without a
 * DOM. Two reveal rules:
 *  - a heading's `#` run reveals when the selection touches that LINE;
 *  - an inline mark reveals when the selection touches its parent span, that
 *    span's own edges included, so arrowing in from outside reveals first.
 * Nothing inside a CriticMarkup span is ever hidden: there the delimiters are
 * the content under review.
 */

export interface HideRange {
  from: number;
  to: number;
}

interface Ctx {
  /** Absolute-position text read. */
  read: (from: number, to: number) => string;
  /** The line containing `pos`, in absolute positions. */
  lineAt: (pos: number) => { from: number; to: number };
  sel: readonly { from: number; to: number }[];
}

/** Does any selection range touch the line holding [from, to]? */
function selTouchesLine(ctx: Ctx, pos: number): boolean {
  const line = ctx.lineAt(pos);
  return ctx.sel.some((r) => r.from <= line.to && r.to >= line.from);
}

/** Does any selection range touch the span, its own edges included? Edge-
 *  inclusive is what makes arrowing in from outside reveal the marks on the step
 *  that reaches the span, rather than one step later with the caret inside
 *  hidden text. */
function selTouchesSpan(ctx: Ctx, from: number, to: number): boolean {
  return ctx.sel.some((r) => r.from <= to && r.to >= from);
}

/** Whitespace run after `pos`, so `## ` hides whole and the text does not indent. */
function spacesAfter(ctx: Ctx, pos: number, limit: number): number {
  let end = pos;
  while (end < limit && /[ \t]/.test(ctx.read(end, end + 1))) end++;
  return end;
}

/** Whitespace run before `pos` (a heading's closing `##` takes its space too). */
function spacesBefore(ctx: Ctx, pos: number, limit: number): number {
  let start = pos;
  while (start > limit && /[ \t]/.test(ctx.read(start - 1, start))) start--;
  return start;
}

/**
 * Walk the parsed tree between `from` and `to` and return the mark ranges to
 * hide, ordered and non-overlapping. Positions are the tree's own, which for the
 * editor are absolute document positions.
 */
function collect(tree: Tree, ctx: Ctx, from: number, to: number): HideRange[] {
  const out: HideRange[] = [];
  const add = (a: number, b: number) => {
    if (b > a) out.push({ from: a, to: b });
  };

  tree.iterate({
    from,
    to,
    enter: (n: SyntaxNodeRef) => {
      const parent = n.node.parent;
      if (!parent) return;
      switch (n.name) {
        case "HeaderMark": {
          // ATX only. A setext underline is also a HeaderMark, and hiding it
          // would leave the heading text looking like a plain paragraph.
          if (!/^ATXHeading/.test(parent.name)) return;
          if (selTouchesLine(ctx, n.from)) return;
          const line = ctx.lineAt(n.from);
          if (n.from <= line.from + 3) add(n.from, spacesAfter(ctx, n.to, line.to));
          // A closing run (`## Heading ##`) takes the space before it instead.
          else add(spacesBefore(ctx, n.from, line.from), n.to);
          return;
        }
        case "EmphasisMark":
        case "StrikethroughMark":
          if (!selTouchesSpan(ctx, parent.from, parent.to)) add(n.from, n.to);
          return;
        case "CodeMark":
          // Also the fence of a code block, whose content is not styled here.
          if (parent.name !== "InlineCode") return;
          if (!selTouchesSpan(ctx, parent.from, parent.to)) add(n.from, n.to);
          return;
        case "LinkMark":
        case "URL":
        case "LinkTitle":
          // A Link only: an image's `![alt](src)` stays literal in this version.
          if (parent.name !== "Link") return;
          if (!selTouchesSpan(ctx, parent.from, parent.to)) add(n.from, n.to);
          return;
        default:
          return;
      }
    },
  });

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  // Drop anything covered by a CriticMarkup span (there the delimiters are the
  // content under review), then merge touching ranges. A link hides as `]`,
  // `(`, the URL and `)`, four ranges in a row: left separate, the caret can sit
  // at a boundary BETWEEN two of them, which is invisible and puts typed text
  // inside the URL. One range per contiguous run is one atom, so End lands after
  // it and typing appends where it looks like it will.
  const critic = criticSpans(ctx.read(from, to), from);
  const kept: HideRange[] = [];
  for (const r of out) {
    if (critic.some((s) => r.from < s.to && r.to > s.from)) continue;
    const prev = kept[kept.length - 1];
    if (prev && r.from <= prev.to) prev.to = Math.max(prev.to, r.to);
    else kept.push({ ...r });
  }
  return kept;
}

/**
 * The hide decision as a pure function: parse `text` and return the mark ranges
 * hidden given these selection ranges. Same logic the plugin runs.
 */
export function hideRanges(text: string, sel: readonly { from: number; to: number }[] = []): HideRange[] {
  const tree = markdownLanguage.parser.parse(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const ctx: Ctx = {
    read: (a, b) => text.slice(a, b),
    lineAt: (pos) => {
      let lo = 0;
      for (let i = 0; i < lineStarts.length; i++) if (lineStarts[i] <= pos) lo = i;
      const start = lineStarts[lo];
      const nl = text.indexOf("\n", start);
      return { from: start, to: nl === -1 ? text.length : nl };
    },
    sel,
  };
  return collect(tree, ctx, 0, text.length);
}

const hidden = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const state = view.state;
  const ctx: Ctx = {
    read: (a, b) => state.doc.sliceString(a, b),
    lineAt: (pos) => {
      const l = state.doc.lineAt(pos);
      return { from: l.from, to: l.to };
    },
    sel: state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
  };
  const tree = syntaxTree(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    // Whole lines, so a mark starting just above the viewport is still matched.
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(to).to;
    for (const r of collect(tree, ctx, start, end)) builder.add(r.from, r.to, hidden);
  }
  return builder.finish();
}

/**
 * The extension. Unlike the other decoration plugins here it also rebuilds on
 * `selectionSet`, because the selection is what reveals a mark; that is one pass
 * over the visible range per cursor move. `atomicRanges` keeps the caret out of
 * the hidden text, so arrow keys step over a hidden `##` instead of stalling
 * inside it.
 */
const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

/**
 * Inline typography, which only live preview turns on: with the `**` hidden,
 * something has to carry the emphasis. The source View has no syntax
 * highlighting at all and keeps it that way, which is why this rides in the same
 * compartment rather than in the editor's base extensions. Heading sizes stay in
 * CSS, on the `.cm-h1`-`.cm-h6` line classes `markdownLineStyle` already emits.
 */
const liveHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  { tag: tags.link, color: "var(--color-coral)" },
  { tag: tags.url, color: "var(--color-muted)" },
]);

export const livePreview = [livePlugin, syntaxHighlighting(liveHighlight)];
