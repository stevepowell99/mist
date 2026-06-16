import { stripFrontmatter } from "./slides-build";

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
 * the index is N - 1, matching reveal's DOM-order fragment numbering. CriticMarkup
 * deletions are dropped first, since their `.fragment` never reaches the deck.
 */
export function fragmentIndexForOffset(md: string, offset: number): number {
  const slide = slideIndexForOffset(md, offset);
  const slideStart = offsetForSlideIndex(md, slide);
  if (offset <= slideStart) return -1;
  const prefix = md.slice(slideStart, offset).replace(/\{--[\s\S]*?--\}/g, "");
  const matches = prefix.match(/\.fragment\b/g);
  return matches ? matches.length - 1 : -1;
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
