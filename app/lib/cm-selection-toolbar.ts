import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { StateField, Transaction } from "@codemirror/state";
import { commentTextAt } from "./cm-comments";
import { criticSpans, type CriticSpan } from "./cm-criticmarkup";
import { resolveAtCursor } from "./cm-suggestion-actions";

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

/** Accept or reject the suggestion the selection sits on, by a direct edit on
 *  the literal CriticMarkup (a userEvent, so the save baseline freezes). */
function resolveSuggestion(view: EditorView, accept: boolean): void {
  const { from } = view.state.selection.main;
  const change = resolveAtCursor(view.state.doc.toString(), from, accept);
  if (change) view.dispatch({ changes: change, userEvent: "input.accept", scrollIntoView: true });
  view.focus();
}

/** The suggestion span (addition/deletion/substitution) that WHOLLY contains the
 *  selection, so the toolbar only offers accept/reject when the selection is the
 *  markup itself, not markup plus surrounding text. */
function suggestionAround(text: string, from: number, to: number): CriticSpan | null {
  for (const s of criticSpans(text)) {
    if (
      (s.type === "addition" || s.type === "deletion" || s.type === "substitution") &&
      from >= s.from &&
      to <= s.to
    ) {
      return s;
    }
  }
  return null;
}

function buildToolbar(view: EditorView, canEdit: boolean): { dom: HTMLElement } {
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

  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();

  // When the selection is wholly a suggestion, edit users get accept/reject for
  // it (suggesting on top of a suggestion makes no sense, so nothing else).
  if (canEdit && suggestionAround(text, from, to)) {
    add("Accept", "Accept this suggestion", () => resolveSuggestion(view, true));
    add("Reject", "Reject this suggestion", () => resolveSuggestion(view, false));
    return { dom };
  }

  // When the selection is wholly on one comment (its highlight or the comment
  // span), manage that comment instead of creating a new suggestion. Reply is
  // open to everyone who can see it; resolve/delete need edit rights.
  const cFrom = commentTextAt(text, from);
  const cTo = commentTextAt(text, to);
  const onComment = cFrom && cFrom === cTo ? cFrom : null;
  if (onComment) {
    add("Reply", "Reply to this comment", () =>
      window.dispatchEvent(new CustomEvent("mist-reply", { detail: onComment })));
    if (canEdit) {
      add("Resolve", "Resolve this comment", () =>
        window.dispatchEvent(new CustomEvent("mist-comment-resolve", { detail: onComment })));
      add("Delete", "Delete this comment", () =>
        window.dispatchEvent(new CustomEvent("mist-comment-delete", { detail: onComment })));
    }
    return { dom };
  }

  add("Comment", "Comment on the selection", () => window.dispatchEvent(new CustomEvent("mist-comment")));
  add("Delete", "Suggest deleting the selection", () => applySuggestion(view, "delete"));
  add("Replace", "Suggest replacing the selection", () => applySuggestion(view, "replace"));
  add("Insert", "Suggest inserting after the selection", () => applySuggestion(view, "insert"));
  return { dom };
}

export function selectionToolbar(getCanEdit: () => boolean) {
  const tooltipsFor = (state: EditorView["state"]): readonly Tooltip[] => {
    const sel = state.selection.main;
    if (sel.empty) return [];
    return [{ pos: sel.from, above: true, arrow: false, create: (view) => buildToolbar(view, getCanEdit()) }];
  };
  const field = StateField.define<readonly Tooltip[]>({
    create: tooltipsFor,
    update(value, tr) {
      if (!tr.docChanged && tr.selection === undefined) return value;
      return tooltipsFor(tr.state);
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  });
  return [field];
}
