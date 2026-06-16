/** A heading in the document, for the outline panel. */
export interface OutlineItem {
  level: number;
  title: string;
  /** ProseMirror position of the heading paragraph node. */
  pos: number;
  /** Length of the heading's text, for replacing it on hide/unhide. */
  len: number;
  hidden: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** True when a heading line marks its slide hidden (Quarto `visibility="hidden"`
 *  or a `.hidden`/`.hidden-slide` class). */
export function isHiddenHeading(text: string): boolean {
  return /\bvisibility\s*=\s*"hidden"/.test(text) || /\{[^}]*\.hidden(?:-slide)?\b[^}]*\}/.test(text);
}

/** The display title: heading text with any `{...}` attribute block removed. */
export function headingTitle(raw: string): string {
  return raw.replace(/\s*\{[^}]*\}\s*$/, "").trim() || "untitled";
}

/** The heading line with its hidden marker toggled (via `visibility="hidden"`). */
export function toggleHiddenText(text: string): string {
  if (isHiddenHeading(text)) {
    return text
      .replace(/\s*visibility\s*=\s*"hidden"/g, "")
      .replace(/\s*\{\s*\}\s*$/, "")
      .replace(/\s+$/, "");
  }
  const trimmed = text.replace(/\s+$/, "");
  if (/\{[^}]*\}$/.test(trimmed)) {
    return trimmed.replace(/\{([^}]*)\}$/, (_m, inner: string) => `{${inner.trim()} visibility="hidden"}`);
  }
  return `${trimmed} {visibility="hidden"}`;
}

/** End offset of the section that starts at items[idx]: the next heading at the
 *  same or shallower level, or the end of the document. Includes deeper
 *  subsections, so moving a section (or a deck's vertical stack) carries its
 *  children. `items` must be the full heading list, not a level-filtered view. */
export function sectionEnd(items: OutlineItem[], idx: number, textLength: number): number {
  const level = items[idx].level;
  for (let j = idx + 1; j < items.length; j++) {
    if (items[j].level <= level) return items[j].pos;
  }
  return textLength;
}

/**
 * Move the section starting at `srcIdx` so it sits at `dstPos` (a heading start
 * offset in the original text, or text.length to drop at the end). Returns the
 * new full text, or null for a no-op (dropping inside the section's own range).
 * Newlines are normalised so headings never end up joined onto one line.
 */
export function moveSection(
  items: OutlineItem[],
  text: string,
  srcIdx: number,
  dstPos: number,
): string | null {
  const srcStart = items[srcIdx].pos;
  const srcEnd = sectionEnd(items, srcIdx, text.length);
  if (dstPos >= srcStart && dstPos <= srcEnd) return null; // inside itself
  let block = text.slice(srcStart, srcEnd);
  if (!block.endsWith("\n")) block += "\n";
  const rest = text.slice(0, srcStart) + text.slice(srcEnd);
  const at = dstPos <= srcStart ? dstPos : dstPos - (srcEnd - srcStart);
  // Dropping at the very end of a file with no trailing newline: keep the moved
  // heading on its own line.
  if (at === rest.length && rest.length > 0 && !rest.endsWith("\n")) block = "\n" + block;
  const next = rest.slice(0, at) + block + rest.slice(at);
  return next === text ? null : next;
}

/** Extract the heading outline from raw markdown text (CodeMirror / Y.Text
 *  core). `pos` is the document offset of the heading line's start, so the
 *  panel can scroll to it and replace the line on hide/unhide. */
export function extractOutlineFromText(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const m = HEADING_RE.exec(line);
    if (m) {
      items.push({
        level: m[1].length,
        title: headingTitle(m[2]),
        pos: offset,
        len: line.length,
        hidden: isHiddenHeading(line),
      });
    }
    offset += line.length + 1; // account for the split-out newline
  }
  return items;
}
