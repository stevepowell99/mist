import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/* ---------- ProseMirror plugin ---------- */

export interface ModeSource {
  get: (key: string) => string | undefined;
}

const pluginKey = new PluginKey("suggestMode");

/**
 * Check if the character before `pos` has a specific mark.
 * Returns the mark if found, null otherwise.
 */
function markBefore(
  state: import("@tiptap/pm/state").EditorState,
  pos: number,
  markName: string,
) {
  if (pos <= 0) return null;
  const node = state.doc.nodeAt(pos - 1);
  if (!node) return null;
  return node.marks.find((m) => m.type.name === markName) ?? null;
}

/** Check if the character at `pos` (the one a forward-Delete would remove) has a mark. */
function markAfter(
  state: import("@tiptap/pm/state").EditorState,
  pos: number,
  markName: string,
) {
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  return node.marks.find((m) => m.type.name === markName) ?? null;
}

/**
 * Check if the entire range [from, to) is within a single run of the given mark.
 */
function rangeHasOnlyMark(
  state: import("@tiptap/pm/state").EditorState,
  from: number,
  to: number,
  markName: string,
): boolean {
  if (from >= to) return false;
  let allMarked = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!allMarked) return false;
    if (node.isText) {
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      if (start < end) {
        const hasMark = node.marks.some((m) => m.type.name === markName);
        if (!hasMark) allMarked = false;
      }
    }
  });
  return allMarked;
}

export function suggestModePlugin(docState: ModeSource): Plugin {
  return new Plugin({
    key: pluginKey,
    props: {
      // Block drag-and-drop in suggest mode: a dropped payload would otherwise
      // insert directly, bypassing suggestion tracking.
      handleDrop() {
        return (docState.get("mode") ?? "suggest") === "suggest";
      },

      handleTextInput(view, from, to, text) {
        // Suggest is the default; only an explicit "edit" turns it off
        const mode = docState.get("mode") ?? "suggest";
        if (mode !== "suggest") return false;

        const { state, dispatch } = view;
        const additionType = state.schema.marks.criticAddition;
        const deletionType = state.schema.marks.criticDeletion;
        if (!additionType || !deletionType) return false;

        if (from === to) {
          // Insertion: always apply criticAddition mark explicitly
          // (inclusive is false so PM won't extend marks at boundaries)
          const tr = state.tr;
          tr.insertText(text, from);
          tr.addMark(from, from + text.length, additionType.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length)));
          dispatch(tr);
          return true;
        }

        // Selection replacement inside an addition — replace and keep mark
        if (rangeHasOnlyMark(state, from, to, "criticAddition")) {
          const tr = state.tr;
          tr.insertText(text, from, to);
          tr.addMark(from, from + text.length, additionType.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length)));
          dispatch(tr);
          return true;
        }

        // Selection replacement: mark old as deleted, insert new as added
        const tr = state.tr;
        tr.addMark(from, to, deletionType.create());
        tr.insertText(text, to);
        tr.addMark(to, to + text.length, additionType.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(to + text.length)));
        dispatch(tr);
        return true;
      },

      handleKeyDown(view, event) {
        // Suggest is the default; only an explicit "edit" turns it off
        const mode = docState.get("mode") ?? "suggest";
        if (mode !== "suggest") return false;

        const isBackspace = event.key === "Backspace";
        const isDelete = event.key === "Delete";
        if (!isBackspace && !isDelete) return false;

        const { state, dispatch } = view;
        const { from, to, empty } = state.selection;
        const additionType = state.schema.marks.criticAddition;
        const deletionType = state.schema.marks.criticDeletion;
        if (!additionType || !deletionType) return false;

        if (!empty) {
          // Non-empty selection (same for Backspace and Delete)
          if (rangeHasOnlyMark(state, from, to, "criticAddition")) {
            return false; // Normal delete inside addition (shrinks it)
          }
          if (rangeHasOnlyMark(state, from, to, "criticDeletion")) {
            return true; // No-op inside deletion
          }

          // Mark selection as deleted
          const tr = state.tr;
          tr.addMark(from, to, deletionType.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(isBackspace ? from : to)));
          dispatch(tr);
          return true;
        }

        if (isBackspace) {
          // Single character backspace
          if (from <= 1) return false; // At start of doc content
          const $from = state.doc.resolve(from);
          if ($from.parentOffset <= 0) return false; // At start of paragraph
          if (markBefore(state, from, "criticAddition")) return false; // shrink insertion
          if (markBefore(state, from, "criticDeletion")) return true; // no-op in deletion
          const tr = state.tr;
          tr.addMark(from - 1, from, deletionType.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(from - 1)));
          dispatch(tr);
          return true;
        }

        // Forward Delete
        const $from = state.doc.resolve(from);
        if ($from.parentOffset >= $from.parent.content.size) return false; // end of paragraph
        if (markAfter(state, from, "criticAddition")) return false; // shrink insertion forward
        if (markAfter(state, from, "criticDeletion")) {
          // Step over an already-deleted character
          dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(from + 1))));
          return true;
        }
        const tr = state.tr;
        tr.addMark(from, from + 1, deletionType.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
        dispatch(tr);
        return true;
      },

      handlePaste(view, _event, slice) {
        const mode = docState.get("mode") ?? "suggest";
        if (mode !== "suggest") return false;

        const text = slice.content.textBetween(0, slice.content.size, "\n");
        if (!text) return false; // non-text payloads fall through to default

        const { state, dispatch } = view;
        const { from, to, empty } = state.selection;
        const additionType = state.schema.marks.criticAddition;
        const deletionType = state.schema.marks.criticDeletion;
        if (!additionType || !deletionType) return false;

        const tr = state.tr;
        if (!empty && !rangeHasOnlyMark(state, from, to, "criticDeletion")) {
          tr.addMark(from, to, deletionType.create()); // replaced text marked deleted
        }
        const at = empty ? from : to;
        tr.insertText(text, at);
        tr.addMark(at, at + text.length, additionType.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + text.length)));
        dispatch(tr);
        return true;
      },

      handleDOMEvents: {
        cut(view, event) {
          const mode = docState.get("mode") ?? "suggest";
          if (mode !== "suggest") return false;

          const { state, dispatch } = view;
          const { from, to, empty } = state.selection;
          if (empty) return false;
          const deletionType = state.schema.marks.criticDeletion;
          if (!deletionType) return false;

          // Copy to clipboard but mark as deleted instead of removing
          const text = state.doc.textBetween(from, to, "\n");
          event.clipboardData?.setData("text/plain", text);
          event.preventDefault();
          if (!rangeHasOnlyMark(state, from, to, "criticDeletion")) {
            const tr = state.tr;
            tr.addMark(from, to, deletionType.create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(from)));
            dispatch(tr);
          }
          return true;
        },
      },
    },
  });
}
