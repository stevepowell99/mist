import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * Discrete line styling for the markdown source editor: heading lines get a
 * weight (and a faint background for the top levels) so structure reads at a
 * glance, and the YAML frontmatter block is dimmed so it recedes. Font family
 * and size are left untouched (everything stays monospace, one size); only
 * weight, colour and background change. Line decorations, so they tint the
 * whole line without touching the text.
 */

const HEADING = /^(#{1,6})\s/;
const headingLine = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `cm-h${n}` }));
const frontmatterLine = Decoration.line({ class: "cm-frontmatter" });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // A frontmatter block is a leading `---` ... `---` at the very top.
  let fmEnd = 0;
  if (doc.lines >= 2 && doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text === "---") {
        fmEnd = i;
        break;
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (fmEnd && line.number <= fmEnd) {
        builder.add(line.from, line.from, frontmatterLine);
      } else {
        const m = HEADING.exec(line.text);
        if (m) builder.add(line.from, line.from, headingLine[m[1].length - 1]);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const markdownLineStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
