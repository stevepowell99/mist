import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
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
  /** What replaces the range. Nothing by default; a list mark becomes a real
   *  bullet and an image becomes the picture itself. */
  show?: { bullet: true } | { image: { src: string; alt: string } };
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
  const add = (a: number, b: number, show?: HideRange["show"]) => {
    if (b > a) out.push({ from: a, to: b, ...(show ? { show } : {}) });
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
          // A Link only. An image's own marks are handled by the Image branch,
          // which replaces the whole thing with the picture.
          if (parent.name !== "Link") return;
          if (!selTouchesSpan(ctx, parent.from, parent.to)) add(n.from, n.to);
          return;
        case "ListMark": {
          // A bullet list's `-`, `*` or `+` becomes a real bullet. An ordered
          // list keeps its numbers, which carry meaning.
          if (parent.name !== "ListItem" || parent.node.parent?.name !== "BulletList") return;
          if (selTouchesLine(ctx, n.from)) return;
          add(n.from, n.to, { bullet: true });
          return;
        }
        case "Image": {
          // The picture itself, in place of its markup. Line-based reveal, as
          // for a heading: put the cursor on the line to edit the source. The
          // pattern is the one `rewriteImages` uses, angle-bracket form included
          // (which is how a path with spaces must be written).
          if (selTouchesLine(ctx, n.from)) return;
          const m = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)$/.exec(
            ctx.read(n.from, n.to),
          );
          if (!m) return;
          add(n.from, n.to, { image: { alt: m[1], src: (m[2] ?? m[3]).trim() } });
          return;
        }
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
    // Only plain hides merge. A range that shows something (a bullet, a
    // picture) has to stay its own decoration.
    if (prev && !prev.show && !r.show && r.from <= prev.to) prev.to = Math.max(prev.to, r.to);
    else if (!prev || r.from >= prev.to) kept.push({ ...r });
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

/** A list's real bullet, standing in for its `-`. */
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

/** The picture itself, in place of `![alt](src)`. The src is resolved by the
 *  caller (the document's own asset proxy), because this module knows nothing
 *  about Drive or the local sidecar. */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-img";
    img.src = this.src;
    img.alt = this.alt;
    // A broken src must not leave a blank gap with nothing to click: fall back
    // to the alt text and the path.
    img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("span"), {
        className: "cm-lp-img-missing",
        textContent: `[image not found: ${this.src}]`,
      }));
    });
    return img;
  }
  get estimatedHeight() {
    return 120;
  }
}

const imageLine = Decoration.line({ class: "cm-lp-imgline" });

function decorationFor(r: HideRange, resolveSrc: (src: string) => string): Decoration {
  if (r.show && "bullet" in r.show) return bullet;
  if (r.show && "image" in r.show) {
    return Decoration.replace({ widget: new ImageWidget(resolveSrc(r.show.image.src), r.show.image.alt) });
  }
  return hidden;
}

function build(view: EditorView, resolveSrc: (src: string) => string): DecorationSet {
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
    for (const r of collect(tree, ctx, start, end)) {
      // A line holding nothing but a picture drops the text leading, which would
      // otherwise leave a line's worth of blank space above and below it.
      if (r.show && "image" in r.show) {
        const line = state.doc.lineAt(r.from);
        if (line.text.trim() === state.doc.sliceString(r.from, r.to).trim()) {
          builder.add(line.from, line.from, imageLine);
        }
      }
      builder.add(r.from, r.to, decorationFor(r, resolveSrc));
    }
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
const livePlugin = (resolveSrc: (src: string) => string) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, resolveSrc);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view, resolveSrc);
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

/** The live preview extension. `resolveSrc` turns an image's markdown src into a
 *  loadable URL (the document's asset proxy); without one, images stay literal
 *  markup rather than pointing at a path the browser cannot fetch. */
export const livePreview = (resolveSrc?: (src: string) => string) => [
  livePlugin(resolveSrc ?? ((s) => s)),
  syntaxHighlighting(liveHighlight),
];
