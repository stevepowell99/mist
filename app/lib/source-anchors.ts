/**
 * Source anchors: the shared coordinate that lets the panels scroll together.
 *
 * The three panes measure position in three incompatible ways (editor: a
 * character offset; preview: a pixel y; comments: a card in a list), so they can
 * only be kept in step through ONE common coordinate. That coordinate is the
 * source character offset, because it is the only one that is exact everywhere:
 * CodeMirror renders just the lines near its viewport and merely ESTIMATES the
 * height of the rest, so an editor pixel far from the viewport is fiction.
 *
 * To convert an offset to a preview pixel we need to know where each piece of the
 * source ended up on the page. Headings alone were far too coarse: between two
 * headings the position was interpolated by character fraction, and a section
 * holding an image, a table or a code block is tall on the page and short in
 * characters, so the two panes drifted by hundreds of pixels within a section.
 *
 * So before the markdown is rendered, a marker carrying the source offset is
 * inserted ahead of every top-level block. It survives the whole render pipeline
 * (it matches none of the grammar converters) and lands in the DOM as an empty,
 * hidden `<br data-pos="...">` just before the element that block became. The
 * preview then carries its own map: one anchor per paragraph, list, table, quote,
 * fence or heading, so interpolation error is bounded by a single block.
 *
 * `<br>` is the marker tag for two boring reasons: it is void, so the HTML parser
 * cannot nest the rest of the document inside it (an unclosed `<span>` would),
 * and a lone open tag on its own line is a block-level HTML block for the
 * markdown parser, so it never joins the paragraph after it.
 */

/** Hides the markers. They are read through the element that follows them. */
export const POS_ANCHOR_CSS = ".preview br[data-pos]{display:none}";

const FENCE = /^ {0,3}(```+|~~~+)/;
const LIST = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t])/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;

/**
 * Insert a `<br data-pos="N">` marker before each top-level block of `md`.
 * `base` is added to every offset, so the numbers are positions in the EDITOR
 * document even though the text here has had its frontmatter and banner stripped.
 */
export function insertPosAnchors(md: string, base = 0): string {
  const lines = md.split("\n");
  const lineOff: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineOff.push(off);
    off += line.length + 1;
  }

  const out: string[] = [];
  const mark = (i: number) => {
    // A marker may never interrupt a paragraph (markdown would fold it into the
    // text), so it always follows a blank line.
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(`<br data-pos="${base + lineOff[i]}">`, "");
  };

  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      out.push(lines[i]);
      i++;
      continue;
    }

    mark(i);

    const fence = lines[i].match(FENCE);
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "```" : "~~~"}`);
      out.push(lines[i]);
      i++;
      while (i < lines.length) {
        const closed = close.test(lines[i]);
        out.push(lines[i]);
        i++;
        if (closed) break;
      }
      continue;
    }

    // A list is ONE block even when its items are separated by blank lines: a
    // marker dropped between two items would end the list and start a new one.
    const isList = LIST.test(lines[i]);
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        let j = i;
        while (j < lines.length && lines[j].trim() === "") j++;
        const loose = isList && j < lines.length && (LIST.test(lines[j]) || /^\s{2,}\S/.test(lines[j]));
        if (!loose) break;
        for (; i < j; i++) out.push(lines[i]);
        continue;
      }
      if (FENCE.test(line)) break; // the fence is its own block, with its own anchor
      out.push(line);
      i++;
      if (HEADING.test(line)) break; // a heading is a one-line block
    }
  }

  return out.join("\n");
}
