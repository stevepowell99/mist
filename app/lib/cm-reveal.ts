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
  // The visible height, not the scroller's: both hosts let the editor grow to
  // its content inside a scrolling pane, so `scrollDOM` is as tall as the whole
  // document and a fifth of it put the target far below the fold.
  const visible = Math.min(view.scrollDOM.clientHeight, window.innerHeight);
  const yMargin = Math.round(visible * FROM_TOP);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin }),
  });
}

/**
 * Scroll `pos` to the top of the view, with just enough room above it to read
 * as a top rather than as a clipped edge.
 *
 * This is the right landing for a heading picked from the contents: the section
 * you asked for should start at the top with its body below it, not sit at the
 * bottom of the screen with the previous section above it, which is what
 * CodeMirror's own minimum-distance scrolling gives you when the target is
 * below the fold.
 */
export function revealPosAtTop(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos }, effects: scrollPosToTop(pos) });
}

/** The scroll of revealPosAtTop alone, for a caller that leaves the cursor be. */
export function scrollPosToTop(pos: number) {
  return EditorView.scrollIntoView(pos, { y: "start", yMargin: 16 });
}

/**
 * Whether `pos` is on screen: drawn, and inside every pane around the editor
 * that clips it. Both hosts scroll a pane the editor grows inside, so the
 * editor's own box says nothing about what is in view.
 */
export function posOnScreen(view: EditorView, pos: number): boolean {
  const c = view.coordsAtPos(pos);
  if (!c) return false;
  let top = 0;
  let bottom = window.innerHeight;
  for (let el: HTMLElement | null = view.scrollDOM; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowY === "visible") continue;
    const r = el.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return c.top >= top && c.bottom <= bottom;
}
