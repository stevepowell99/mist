import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { StateField, Transaction } from "@codemirror/state";
import { commentTextAt } from "./cm-comments";

/**
 * A floating toolbar over a non-empty selection (the Google-Docs gesture), so
 * commenting and suggesting are discoverable without the sidebar. Unlike Docs or
 * Word, the suggest actions work in ANY mode: CriticMarkup is literal text in the
 * Y.Text, so wrapping a range as `{-- --}` / `{++ ++}` is a normal edit, not a
 * separate "track changes" mode. Comment reuses the existing sidebar flow via a
 * `mist-comment` window event (DocumentContext captures the live selection).
 */

/** Wrap the current selection as a CriticMarkup suggestion. */
function applySuggestion(view: EditorView, kind: "delete" | "replace" | "insert"): void {
  const { from, to } = view.state.selection.main;
  if (from === to && kind !== "insert") return;
  const sel = view.state.sliceDoc(from, to);

  let changes: { from: number; to: number; insert: string };
  let selection: { anchor: number; head?: number };

  if (kind === "delete") {
    const insert = `{--${sel}--}`;
    changes = { from, to, insert };
    selection = { anchor: from + insert.length };
  } else if (kind === "replace") {
    // Delete the old text and seed the addition with a copy, selected, so the
    // user can immediately type the replacement over it.
    const prefix = `{--${sel}--}{++`;
    changes = { from, to, insert: `${prefix}${sel}++}` };
    selection = { anchor: from + prefix.length, head: from + prefix.length + sel.length };
  } else {
    // Insert: suggest new text just after the selection (or at the cursor),
    // cursor placed inside the empty addition to type.
    changes = { from: to, to, insert: "{++++}" };
    selection = { anchor: to + 3 };
  }

  view.dispatch({
    changes,
    selection,
    annotations: Transaction.userEvent.of("input.suggest"),
    scrollIntoView: true,
  });
  view.focus();
}

function buildToolbar(view: EditorView): { dom: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "cm-sel-toolbar";
  const add = (label: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-sel-btn";
    b.textContent = label;
    b.title = title;
    // Keep the editor selection/focus when the button is pressed.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    dom.appendChild(b);
  };
  // If the selection sits on an existing comment, offer a direct reply to it
  // (the highlighted text or the comment span both count as "on" the comment).
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const onComment = commentTextAt(text, from) ?? commentTextAt(text, to);
  if (onComment) {
    add("Reply", "Reply to this comment", () =>
      window.dispatchEvent(new CustomEvent("mist-reply", { detail: onComment })));
  }
  add("Comment", "Comment on the selection", () => window.dispatchEvent(new CustomEvent("mist-comment")));
  add("Delete", "Suggest deleting the selection", () => applySuggestion(view, "delete"));
  add("Replace", "Suggest replacing the selection", () => applySuggestion(view, "replace"));
  add("Insert", "Suggest inserting after the selection", () => applySuggestion(view, "insert"));
  return { dom };
}

function selectionTooltips(state: EditorView["state"]): readonly Tooltip[] {
  const sel = state.selection.main;
  if (sel.empty) return [];
  return [{ pos: sel.from, above: true, arrow: false, create: buildToolbar }];
}

const selectionToolbarField = StateField.define<readonly Tooltip[]>({
  create: selectionTooltips,
  update(value, tr) {
    if (!tr.docChanged && tr.selection === undefined) return value;
    return selectionTooltips(tr.state);
  },
  provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
});

export function selectionToolbar() {
  return [selectionToolbarField];
}
