import { EditorState } from "@codemirror/state";
import { crosshairCursor, drawSelection, dropCursor, rectangularSelection } from "@codemirror/view";
import { highlightSelectionMatches } from "@codemirror/search";

/**
 * Selection helpers, shared by the Drive editor and the local editor so that
 * selecting works the same in both: Ctrl/Cmd+D adds the next occurrence (the
 * binding comes with `searchKeymap`), Ctrl/Cmd-click adds a cursor, Alt-drag
 * selects a rectangle, matches of the selection are highlighted, and a drag
 * shows where it will drop.
 *
 * `allowMultipleSelections` is the part that matters most. Without it
 * CodeMirror keeps only the main range of every selection, so Ctrl/Cmd+D can
 * select a word but never add the next one, and nothing reports why.
 */
export const selectionHelpers = [
  EditorState.allowMultipleSelections.of(true),
  drawSelection(),
  dropCursor(),
  rectangularSelection(),
  crosshairCursor(),
  highlightSelectionMatches(),
];
