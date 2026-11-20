import { classesFrom, deckSlideLayout, firstContentLine, slideSpans, stripFrontmatter, type DeckSlide } from "./slides-build";

/**
 * Two ways of counting slides, kept apart on purpose:
 * - the SOURCE index counts every slide of the split, hidden ones included,
 *   in step with `deckSlides` (the library saves the slide the cursor is in);
 * - the DECK index counts what the deck shows (`deckSlideLayout`): reveal's
 *   flat `h`, the one `mist-slide`, `mist-goto`, `?slide=`, presence and the
 *   speaker notes all use.
 */

/** The last entry whose `start` is at or before `offset` (the first entry when
 *  none is), by binary search over entries in source order. */
function lastAtOrBefore(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The SOURCE index of the slide containing `offset` in the full editor
 * markdown (frontmatter included): its place among every slide of the split,
 * hidden ones included. A slide begins at its first non-empty line, so the
 * blank lines and `---` rule before it still count as the slide above.
 */
export function slideIndexForOffset(md: string, offset: number): number {
  const { body } = stripFrontmatter(md);
  const fmLen = md.length - body.length;
  const starts = slideSpans(body).map((s) => fmLen + s.from + (s.text.length - s.text.replace(/^(?:[ \t]*\n)*/, "").length));
  return lastAtOrBefore(starts, offset);
}

/** The deck slide holding `offset`. A hidden slide is returned as itself
 *  (`hidden` set, `deck` the shown slide before it), so a caller can tell. */
export function deckSlideAt(layout: DeckSlide[], offset: number): DeckSlide | null {
  if (!layout.length) return null;
  return layout[lastAtOrBefore(layout.map((s) => s.start), offset)];
}

/** The DECK index of the slide holding `offset`; in a hidden slide, the shown
 *  slide before it, so the deck stays nearby rather than jumping. */
export function deckIndexForOffset(md: string, offset: number, layout = deckSlideLayout(md)): number {
  return deckSlideAt(layout, offset)?.deck ?? 0;
}

/** The offset of the first line of deck slide `index`, or null past the last
 *  one (the References slide the deck appends has no source). */
export function offsetForDeckIndex(md: string, index: number, layout = deckSlideLayout(md)): number | null {
  return layout.find((s) => !s.hidden && s.deck === Math.max(0, index))?.start ?? null;
}

/**
 * The 0-based reveal fragment index the cursor sits at within its slide, or -1
 * when the cursor is before any fragment, so the preview can reveal the deck up
 * to the `.fragment` the cursor is editing. Counts `.fragment` class markers
 * (fenced divs, `[..]{.fragment}` spans, images) from the slide start to the
 * cursor: being inside the Nth fragment means N markers precede the cursor, so
 * the index is N - 1, matching reveal's DOM-order fragment numbering. The
 * fragments `.incremental` implies are counted too. CriticMarkup deletions are
 * dropped first, since their `.fragment` never reaches the deck. A hidden slide
 * has no fragments on screen, so it gives -1.
 */
export function fragmentIndexForOffset(md: string, offset: number, layout = deckSlideLayout(md)): number {
  const slide = deckSlideAt(layout, offset);
  if (!slide || slide.hidden) return -1;
  const slideStart = slide.start;
  if (offset <= slideStart) return -1;
  const prefix = md.slice(slideStart, offset).replace(/\{--[\s\S]*?--\}/g, "");
  const explicit = prefix.match(/\.fragment\b/g)?.length ?? 0;
  return explicit + incrementalFragmentCount(prefix) - 1;
}

/** Classes that keep a child of an `.incremental` box from becoming a fragment. */
const NOT_INCREMENTED = ["fragment", "incremental", "nonincremental", "notes"];

/**
 * How many fragments `.incremental` implies in `text`, a slide's source from its
 * first line up to the cursor. The deck applies the rule to the rendered slide
 * (`markIncremental` in slides-runtime.ts): each child block of an incremental
 * box is a fragment, where the box is the slide when its heading carries the
 * class, or a `::: {.incremental}` div; a list counts each top-level item as a
 * child; the slide title, notes and any child already `.fragment`,
 * `.incremental` or `.nonincremental` are left alone. This walks the source with
 * the same rule, finding blocks the way markdown does (blank lines, headings,
 * code fences, list items, `:::` fences), so change the two together.
 */
export function incrementalFragmentCount(text: string): number {
  type Box = { on: boolean; block: boolean; list: boolean; listIndent: number; blank: boolean };
  const box = (on: boolean): Box => ({ on, block: false, list: false, listIndent: 0, blank: false });
  const lines = text.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first++;
  const title = (lines[first] ?? "").match(/^#{1,6}\s+.*?\{([^}]*)\}\s*$/);
  const boxes = [box(!!title && classesFrom(title[1]).includes("incremental"))];
  let fence = ""; // the open code fence's marker, e.g. "```"
  let count = 0;
  for (let i = first; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const b = boxes[boxes.length - 1];
    if (fence) {
      if (t.startsWith(fence)) {
        fence = "";
        b.block = false;
      }
      continue;
    }
    if (i === first && /^#{1,6}\s/.test(line)) continue; // the slide title stays put
    if (t === "") {
      if (!b.list) b.block = false;
      b.blank = true;
      continue;
    }
    if (/^<!--.*-->$/.test(t)) continue; // a comment renders as nothing
    const indent = line.length - line.trimStart().length;
    const div = t.match(/^:{3,}\s*(.*)$/);
    if (div) {
      b.list = false;
      b.blank = false;
      if (!div[1]) {
        // A bare closer ends the innermost div; whatever follows is a new block.
        if (boxes.length > 1) boxes.pop();
        boxes[boxes.length - 1].block = false;
        continue;
      }
      const braced = div[1].match(/^\{([^}]*)\}\s*$/);
      const cls = braced ? classesFrom(braced[1]) : div[1].split(/\s+/);
      if (b.on && !cls.some((c) => NOT_INCREMENTED.includes(c))) count++;
      b.block = true;
      boxes.push(box(cls.includes("incremental")));
      continue;
    }
    const inItem = b.list && indent >= b.listIndent + 2; // continuation of a list item
    const code = t.match(/^(`{3,}|~{3,})/);
    if (code) {
      if (!inItem) {
        if (b.on) count++;
        b.list = false;
      }
      fence = code[1];
    } else if (/^#{1,6}\s/.test(t) && !inItem) {
      if (b.on) count++;
      b.list = false;
      b.block = false; // a heading is a block of its own line
      b.blank = false;
      continue;
    } else if (/^(?:[-*+]|\d+[.)])(?:\s|$)/.test(t) && !inItem && (b.list || indent < 4)) {
      if (b.on) count++;
      if (!b.list) b.listIndent = indent;
      b.list = true;
    } else if (b.list ? b.blank && !inItem : !b.block) {
      // A paragraph, table, quote or image line opening a new block, including
      // the first one after a list ends.
      if (b.on) count++;
      b.list = false;
    }
    b.block = true;
    b.blank = false;
  }
  return count;
}
