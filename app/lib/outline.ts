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
