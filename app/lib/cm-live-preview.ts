import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { syntaxTree, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { runMermaid } from "./mermaid";
import { criticSpans } from "./critic";
import { CALLOUT_ALIAS } from "./slides-build";
import { citationSpans, type BibLibrary } from "./citations";

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
   *  bullet, an image becomes the picture itself, an attribute block is dimmed
   *  rather than hidden (it is authoring detail, but you need to see it), and a
   *  line entry styles a whole line (a quote, a callout, a lone picture). */
  show?:
    | { bullet: true }
    | { image: { src: string; alt: string } }
    | { fade: true }
    | { line: string }
    | { mark: string }
    | { text: { value: string; cls: string } };
}

interface Ctx {
  /** Absolute-position text read. */
  read: (from: number, to: number) => string;
  /** The line containing `pos`, in absolute positions. */
  lineAt: (pos: number) => { from: number; to: number };
  sel: readonly { from: number; to: number }[];
  /** The document's BibTeX library, when it has one, for showing a citation as
   *  the reference it stands for. */
  bib?: BibLibrary | null;
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
    // A line entry is empty by definition (it styles the line, not a range).
    if (b > a || (show && "line" in show)) out.push({ from: a, to: b, ...(show ? { show } : {}) });
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
        case "QuoteMark": {
          // The `>` of a blockquote, with the line styled as a quote instead.
          if (selTouchesLine(ctx, n.from)) return;
          const line = ctx.lineAt(n.from);
          add(n.from, spacesAfter(ctx, n.to, line.to));
          return;
        }
        case "Blockquote": {
          // Every line of the quote carries the style, and a callout header
          // (`> [!tip] Title`) colours the block and drops its `[!tip]` token.
          const first = ctx.read(n.from, ctx.lineAt(n.from).to);
          const cm = /^\s*>\s*\[!([\w-]+)\][-+]?/.exec(first);
          const type = cm ? (CALLOUT_ALIAS[cm[1].toLowerCase()] ?? cm[1].toLowerCase()) : null;
          const cls = type ? `cm-lp-quote cm-lp-callout cm-lp-callout-${type}` : "cm-lp-quote";
          for (let p = n.from, first_ = true; p <= n.to; first_ = false) {
            const line = ctx.lineAt(p);
            add(line.from, line.from, { line: type && first_ ? `${cls} cm-lp-callout-head` : cls });
            if (line.to >= n.to) break;
            p = line.to + 1;
          }
          if (cm && !selTouchesLine(ctx, n.from)) {
            const at = first.indexOf("[!");
            const end = first.indexOf("]", at) + 1;
            add(n.from + at, spacesAfter(ctx, n.from + end, ctx.lineAt(n.from).to));
          }
          return;
        }
        default:
          return;
      }
    },
  });

  const treeCount = out.length;

  // Several things the parser gives no node for, so they are read off the text.
  // All of them skip code, where the same characters are content.
  const slice = ctx.read(from, to);
  const inCode = (pos: number) => {
    for (let n: SyntaxNodeRef | null = tree.resolveInner(pos, 1); n; n = n.node.parent) {
      if (/^(FencedCode|CodeBlock|CodeText|InlineCode)$/.test(n.name)) return true;
    }
    return false;
  };

  // Constructs the markdown parser reads as something else own their characters
  // outright: inside `[[a wikilink]]` or `[@a citation]` the parser sees a link
  // label and marks its brackets for hiding, which would fight the decoration
  // put there here. Anything the tree walk found inside one of these is dropped.
  const claimed: { from: number; to: number }[] = [];

  // Obsidian's embed, `![[picture.png]]` or `![[picture.png|alt]]`, which the
  // markdown parser does not know: only an image target becomes a picture, so
  // `![[a note]]` stays a wikilink.
  for (const m of slice.matchAll(/!\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g)) {
    const start = from + (m.index ?? 0);
    if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(m[1].trim())) continue;
    if (inCode(start)) continue;
    claimed.push({ from: start, to: start + m[0].length });
    if (selTouchesLine(ctx, start)) continue;
    add(start, start + m[0].length, { image: { alt: m[2] ?? "", src: m[1].trim() } });
  }

  // The Garden's own callout block: a `--{.tip}` line, content, then a `--`.
  // The markers dim and the block between them takes the callout's colour.
  const markerLines = new Set<number>();
  let dashType: string | null = null;
  for (let p = from; p <= to; ) {
    const line = ctx.lineAt(p);
    const text = ctx.read(line.from, line.to);
    const open = /^\s*--\{\.([A-Za-z][\w-]*)\}\s*$/.exec(text);
    if (open) {
      const head = open[1].split("-")[0].toLowerCase();
      dashType = CALLOUT_ALIAS[head] ?? head;
      add(line.from, line.to, { fade: true });
      markerLines.add(line.from);
    } else if (dashType && text.trim() === "--") {
      add(line.from, line.to, { fade: true });
      markerLines.add(line.from);
      dashType = null;
    } else if (dashType) {
      add(line.from, line.from, { line: `cm-lp-callout cm-lp-callout-${dashType}` });
    }
    if (line.to >= to) break;
    p = line.to + 1;
  }

  // Obsidian's wikilink, `[[target]]` or `[[target|the words to show]]`: the
  // brackets and the target go, leaving the words a reader is meant to read,
  // styled as a link. The image embed above has already claimed any `![[...]]`.
  for (const m of slice.matchAll(/(!?)\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g)) {
    const start = from + (m.index ?? 0);
    if (m[1] || inCode(start)) continue;
    claimed.push({ from: start, to: start + m[0].length });
    if (selTouchesLine(ctx, start)) continue;
    const end = start + m[0].length;
    // With an alias, everything up to it goes (`[[target|`); without one, the
    // target itself is what a reader reads, so only the brackets go.
    const shownFrom = m[3] === undefined ? start + 2 : end - 2 - m[3].length;
    add(start, shownFrom);
    add(shownFrom, end - 2, { mark: "cm-lp-wikilink" });
    add(end - 2, end); // `]]`
  }

  // Citations show as the reference they stand for, the same inline APA the
  // Preview pane renders, when the document has a `.bib` to resolve them. The
  // markdown parser reads `[@key]` as a link label, so the brackets are already
  // marked for hiding; a citation therefore takes precedence over anything
  // inside it (see the filter below), or the two would fight and the citation
  // would lose.
  if (ctx.bib) {
    for (const c of citationSpans(slice, ctx.bib, from)) {
      if (inCode(c.from)) continue;
      claimed.push({ from: c.from, to: c.to });
      if (selTouchesSpan(ctx, c.from, c.to)) continue;
      add(c.from, c.to, { text: { value: c.text, cls: "cm-lp-cite" } });
    }
  }

  // Pandoc attributes (`{.rounded}`, `{#id}`, `{width=4cm}`) are dimmed, not
  // hidden: they are authoring detail rather than prose, but you still need to
  // see and edit them. A CriticMarkup span opens `{+`, `{-`, `{~`, `{>`, `{=`,
  // none of which start an attribute, so the two never collide.
  for (const m of slice.matchAll(/\{[.#][^{}\n]*\}|\{[a-z-]+=[^{}\n]*\}/g)) {
    const start = from + (m.index ?? 0);
    // A `--{.tip}` marker line is faded whole, above; fading its class a second
    // time would stack two decorations on the same characters.
    if (inCode(start) || markerLines.has(ctx.lineAt(start).from)) continue;
    add(start, start + m[0].length, { fade: true });
  }

  // Drop what the tree walk found inside a claimed construct, then order the
  // lot. Everything from `treeCount` on came from the scans above, which own
  // those characters by definition.
  const ordered = [
    ...out.slice(0, treeCount).filter((r) => !claimed.some((c) => r.from < c.to && r.to > c.from)),
    ...out.slice(treeCount),
  ];
  ordered.sort((a, b) => a.from - b.from || a.to - b.to);
  // Drop anything covered by a CriticMarkup span (there the delimiters are the
  // content under review), then merge touching ranges. A link hides as `]`,
  // `(`, the URL and `)`, four ranges in a row: left separate, the caret can sit
  // at a boundary BETWEEN two of them, which is invisible and puts typed text
  // inside the URL. One range per contiguous run is one atom, so End lands after
  // it and typing appends where it looks like it will.
  const critic = criticSpans(ctx.read(from, to), from);
  const kept: HideRange[] = [];
  let prevHide: HideRange | null = null;
  let hiddenTo = -1;
  for (const r of ordered) {
    if (critic.some((s) => r.from < s.to && r.to > s.from)) continue;
    // A line style and a fade hide nothing, so they neither merge with a hide
    // nor conflict with one.
    if (r.show && ("line" in r.show || "fade" in r.show)) {
      kept.push({ ...r });
      continue;
    }
    if (prevHide && !prevHide.show && !r.show && r.from <= prevHide.to) {
      prevHide.to = Math.max(prevHide.to, r.to);
      hiddenTo = prevHide.to;
      continue;
    }
    if (r.from < hiddenTo) continue;
    const copy = { ...r };
    kept.push(copy);
    prevHide = copy;
    hiddenTo = copy.to;
  }
  return kept;
}

/**
 * The hide decision as a pure function: parse `text` and return the mark ranges
 * hidden given these selection ranges. Same logic the plugin runs.
 */
export function hideRanges(
  text: string,
  sel: readonly { from: number; to: number }[] = [],
  bib: BibLibrary | null = null,
): HideRange[] {
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
    bib,
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
const faded = Decoration.mark({ class: "cm-lp-attr" });
/** Line decorations are per class string, and there are a handful of them, so
 *  cache rather than allocate one per line per rebuild. */
const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let d = lineDecos.get(cls);
  if (!d) {
    d = Decoration.line({ class: cls });
    lineDecos.set(cls, d);
  }
  return d;
}

/** Plain text standing in for its markup: a citation shown as the reference. */
class TextWidget extends WidgetType {
  constructor(
    readonly value: string,
    readonly cls: string,
  ) {
    super();
  }
  eq(other: TextWidget) {
    return other.value === this.value && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.textContent = this.value;
    return span;
  }
}

const marks = new Map<string, Decoration>();
function markDeco(cls: string): Decoration {
  let d = marks.get(cls);
  if (!d) {
    d = Decoration.mark({ class: cls });
    marks.set(cls, d);
  }
  return d;
}

function decorationFor(r: HideRange, resolveSrc: (src: string) => string): Decoration {
  if (r.show && "bullet" in r.show) return bullet;
  if (r.show && "fade" in r.show) return faded;
  if (r.show && "line" in r.show) return lineDeco(r.show.line);
  if (r.show && "mark" in r.show) return markDeco(r.show.mark);
  if (r.show && "text" in r.show) {
    return Decoration.replace({ widget: new TextWidget(r.show.text.value, r.show.text.cls) });
  }
  if (r.show && "image" in r.show) {
    return Decoration.replace({ widget: new ImageWidget(resolveSrc(r.show.image.src), r.show.image.alt) });
  }
  return hidden;
}

/** Only what actually hides text is atomic: the caret must step over a hidden
 *  `##`, but a faded attribute, a styled line or a marked span is ordinary text
 *  to move through. */
function isHiding(r: HideRange): boolean {
  return !r.show || "bullet" in r.show || "image" in r.show || "text" in r.show;
}

interface Built {
  /** Everything painted. */
  decorations: DecorationSet;
  /** Only the ranges that hide text, which is what the caret must skip. */
  atomic: DecorationSet;
}

function build(view: EditorView, resolveSrc: (src: string) => string, bib: BibLibrary | null): Built {
  const state = view.state;
  const ctx: Ctx = {
    read: (a, b) => state.doc.sliceString(a, b),
    lineAt: (pos) => {
      const l = state.doc.lineAt(pos);
      return { from: l.from, to: l.to };
    },
    sel: state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    bib,
  };
  const tree = syntaxTree(state);
  const builder = new RangeSetBuilder<Decoration>();
  const atomics = new RangeSetBuilder<Decoration>();
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
      const deco = decorationFor(r, resolveSrc);
      builder.add(r.from, r.to, deco);
      if (isHiding(r)) atomics.add(r.from, r.to, deco);
    }
  }
  return { decorations: builder.finish(), atomic: atomics.finish() };
}

/**
 * The extension. Unlike the other decoration plugins here it also rebuilds on
 * `selectionSet`, because the selection is what reveals a mark; that is one pass
 * over the visible range per cursor move. `atomicRanges` keeps the caret out of
 * the hidden text, so arrow keys step over a hidden `##` instead of stalling
 * inside it.
 */
const livePlugin = (resolveSrc: (src: string) => string, getBib: () => BibLibrary | null) =>
  ViewPlugin.fromClass(
    class {
      built: Built;
      constructor(view: EditorView) {
        this.built = build(view, resolveSrc, getBib());
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.built = build(u.view, resolveSrc, getBib());
      }
    },
    {
      decorations: (v) => v.built.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.built.atomic ?? Decoration.none),
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

/**
 * The two block constructs: a table shown as a real table, and a mermaid fence
 * shown as the diagram. Both replace several lines at once, and a decoration
 * that changes the vertical layout cannot come from a ViewPlugin (plugins are
 * computed after the layout they would change), so these live in a state field
 * over the whole document rather than the visible range.
 *
 * Putting the cursor anywhere in the block drops the decoration, which is the
 * whole editing story: the table becomes its own source, you edit the pipes, you
 * move away and it is a table again. Clicking the rendered block does the same,
 * because a widget swallows the click that would otherwise place the cursor.
 */
class BlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly kind: "table" | "mermaid",
    readonly from: number,
  ) {
    super();
  }
  eq(other: BlockWidget) {
    return other.source === this.source && other.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = `cm-lp-block cm-lp-${this.kind}`;
    if (this.kind === "table") {
      wrap.innerHTML = DOMPurify.sanitize(marked.parse(this.source, { async: false }) as string);
    } else {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-mermaid";
      code.textContent = this.source;
      pre.appendChild(code);
      wrap.appendChild(pre);
      void runMermaid(wrap);
    }
    // Click to edit: put the cursor at the start of the block, which reveals the
    // source in the same update.
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }
  get estimatedHeight() {
    return this.kind === "mermaid" ? 220 : 40 + 28 * this.source.split("\n").length;
  }
  ignoreEvent() {
    return false;
  }
}

/** Line-span of every table and mermaid fence the selection is not inside. */
function blockRanges(state: EditorState): { from: number; to: number; widget: BlockWidget }[] {
  const out: { from: number; to: number; widget: BlockWidget }[] = [];
  const sel = state.selection.ranges;
  const add = (from: number, to: number, kind: "table" | "mermaid", source: string) => {
    if (sel.some((r) => r.from <= to && r.to >= from)) return;
    out.push({ from, to, widget: new BlockWidget(source, kind, from) });
  };
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Table") {
        const from = state.doc.lineAt(n.from).from;
        const to = state.doc.lineAt(n.to).to;
        add(from, to, "table", state.doc.sliceString(from, to));
      } else if (n.name === "FencedCode") {
        const from = state.doc.lineAt(n.from).from;
        const to = state.doc.lineAt(n.to).to;
        const lines = state.doc.sliceString(from, to).split("\n");
        const body = lines.slice(1, lines[lines.length - 1].trim().startsWith("```") ? -1 : undefined);
        const info = lines[0].replace(/^\s*`{3,}\s*/, "").trim();
        const src = body.join("\n");
        if (/^\{?mermaid\}?$/i.test(info) || MERMAID_START.test(src)) add(from, to, "mermaid", src);
      }
    },
  });
  return out;
}

/** Mermaid's own opening keywords, so a fence with no language is still read as
 *  a diagram (the same rule `app/lib/mermaid.ts` applies in the preview). */
const MERMAID_START =
  /^\s*(?:%%\{|graph\s|flowchart\s|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|quadrantChart\b|gitGraph\b|xychart-beta\b|block-beta\b|sankey-beta\b|C4Context\b)/;

const blockField = StateField.define<DecorationSet>({
  create: (state) => buildBlocks(state),
  update(value, tr) {
    if (!tr.docChanged && tr.selection === undefined) return value;
    return buildBlocks(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildBlocks(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const b of blockRanges(state)) {
    builder.add(b.from, b.to, Decoration.replace({ widget: b.widget, block: true }));
  }
  return builder.finish();
}

/** The live preview extension. `resolveSrc` turns an image's markdown src into a
 *  loadable URL (the document's asset proxy); without one, images stay literal
 *  markup rather than pointing at a path the browser cannot fetch. `getBib`
 *  gives the document's BibTeX library, so citations show as references. */
export const livePreview = (opts: {
  resolveSrc?: (src: string) => string;
  getBib?: () => BibLibrary | null;
} = {}) => [
  livePlugin(opts.resolveSrc ?? ((s) => s), opts.getBib ?? (() => null)),
  blockField,
  syntaxHighlighting(liveHighlight),
];
