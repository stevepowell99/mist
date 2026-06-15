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
