/**
 * Where the element whose open tag starts at `start` ends: the offset just
 * after its matching close tag, counting nested elements of the same name, or
 * -1 when it is self-closed or never closed before `limit`. Read over the text
 * rather than line by line, so an open tag split across lines still counts.
 * Shared by the live preview's split of a slide into parts and the editor's
 * folds, which must agree on where an inline `<svg>` ends.
 */
export function closeTagEnd(text: string, start: number, name: string, limit = text.length): number {
  const tags = new RegExp(`<(/?)${name}(?=[\\s/>])[^>]*?(/?)>`, "gi");
  let depth = 0;
  for (const m of text.slice(start, limit).matchAll(tags)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth <= 0) return m[1] ? start + (m.index ?? 0) + m[0].length : -1;
  }
  return -1;
}
