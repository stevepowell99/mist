import { foldService } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Folding for the markdown source editor: the YAML frontmatter block and Quarto
 * `::: {.class}` fenced divs can be collapsed from the fold gutter. Returns the
 * range to hide (from the end of the opening line to the end of the closing
 * line) for a foldable line, or null.
 */
const FENCE = /^\s*(:{3,})(.*)$/;

export const mistFolds = foldService.of((state: EditorState, lineStart: number) => {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const text = line.text;

  // Frontmatter: the opening `---` on line 1 folds to its closing `---`.
  if (line.number === 1 && text.trim() === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === "---") return { from: line.to, to: doc.line(i).to };
    }
    return null;
  }

  // Fenced div: an opener (`:::` with content after) folds to its matching
  // closer, tracking nesting so the right `:::` is paired.
  const m = FENCE.exec(text);
  if (m && m[2].trim() !== "") {
    let depth = 1;
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const mm = FENCE.exec(doc.line(i).text);
      if (!mm) continue;
      if (mm[2].trim() === "") {
        depth--;
        if (depth === 0) return { from: line.to, to: doc.line(i).to };
      } else {
        depth++;
      }
    }
  }
  return null;
});
