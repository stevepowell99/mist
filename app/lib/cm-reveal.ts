import { EditorView } from "@codemirror/view";

/**
 * Where a jumped-to target should sit in the viewport: a fifth of the way down.
 *
 * CodeMirror's default scrolls the minimum distance needed, so a target below
 * the fold lands right at the bottom edge with nothing after it, and one above
 * lands at the very top with no context before it. Neither is where you want to
 * read from. A fifth down leaves the preceding sentence or two visible and the
 * rest of the passage below, which is what you want when you have just clicked a
 * comment or a tracked change to see what it is about.
 */
const FROM_TOP = 0.2;

/** Scroll `pos` to a fifth from the top and put the cursor there. Near the start
 *  of a document there is nothing to scroll, and CodeMirror simply lands as
 *  close as it can. */
export function revealPos(view: EditorView, pos: number): void {
  const yMargin = Math.round(view.scrollDOM.clientHeight * FROM_TOP);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin }),
  });
}
