import { classesFrom, stripFrontmatter } from "./slides-build";

/**
 * The 0-based index of the slide containing `offset` in the full editor
 * markdown (frontmatter included). Mirrors `splitSlides` so the result lines up
 * with the rendered deck: a new slide starts at the first non-empty line, at a
 * level-1/2 heading that follows content, and after a `---` rule.
 */
export function slideIndexForOffset(md: string, offset: number): number {
  const { body } = stripFrontmatter(md);
  const fmLen = md.length - body.length; // characters of frontmatter prefix
  const bodyOffset = Math.max(0, offset - fmLen);
  const cursorLine = body.slice(0, bodyOffset).split("\n").length - 1; // 0-based

  const lines = body.split("\n");
  let slideIdx = -1;
  let pendingNewSlide = true; // the next non-empty line starts a new slide
  let curHasContent = false;
  for (let i = 0; i <= cursorLine && i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === "---") {
      pendingNewSlide = true;
      curHasContent = false;
      continue;
    }
    if (/^#{1,2}\s/.test(line) && curHasContent) pendingNewSlide = true; // heading flushes
    if (t !== "") {
      if (pendingNewSlide) {
        slideIdx++;
        pendingNewSlide = false;
      }
      curHasContent = true;
    }
  }
  return Math.max(0, slideIdx);
}

/**
 * The 0-based reveal fragment index the cursor sits at within its slide, or -1
 * when the cursor is before any fragment, so the preview can reveal the deck up
 * to the `.fragment` the cursor is editing. Counts `.fragment` class markers
 * (fenced divs, `[..]{.fragment}` spans, images) from the slide start to the
 * cursor: being inside the Nth fragment means N markers precede the cursor, so
 * the index is N - 1, matching reveal's DOM-order fragment numbering. The
 * fragments `.incremental` implies are counted too. CriticMarkup deletions are
 * dropped first, since their `.fragment` never reaches the deck.
 */
export function fragmentIndexForOffset(md: string, offset: number): number {
  const slide = slideIndexForOffset(md, offset);
  const slideStart = offsetForSlideIndex(md, slide);
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

/**
 * The inverse: the editor offset (in the full markdown, frontmatter included) of
 * the first line of slide `index`. Mirrors the same split, so jumping the editor
 * to the slide shown in the preview lands on that slide's source.
 */
export function offsetForSlideIndex(md: string, index: number): number {
  const { body } = stripFrontmatter(md);
  const fmLen = md.length - body.length;
  const lines = body.split("\n");
  let slideIdx = -1;
  let pendingNewSlide = true;
  let curHasContent = false;
  let charPos = 0; // offset of line i's start within the body
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === "---") {
      pendingNewSlide = true;
      curHasContent = false;
      charPos += line.length + 1;
      continue;
    }
    if (/^#{1,2}\s/.test(line) && curHasContent) pendingNewSlide = true;
    if (t !== "") {
      if (pendingNewSlide) {
        slideIdx++;
        pendingNewSlide = false;
        if (slideIdx === Math.max(0, index)) return fmLen + charPos;
      }
      curHasContent = true;
    }
    charPos += line.length + 1;
  }
  return md.length; // index past the last slide: end of document
}
