import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { criticMarkup } from "~/lib/cm-criticmarkup";
import { suggestMode } from "~/lib/cm-suggest";
import { wrapKeymap, wrapOnSelection } from "~/lib/cm-shortcuts";
import type { DocMode } from "~/shared/types";

/**
 * Y.Text core (#13). A CodeMirror 6 editor bound to `doc.getText("body")` via
 * y-codemirror.next, so the markdown source IS the CRDT. CriticMarkup is
 * literal text styled by decorations; suggest mode rewrites edits into
 * CriticMarkup; clean view hides the delimiters via a class. Collaborative
 * cursors come from the binding; undo is the Yjs UndoManager, so a remote edit
 * is never undone by a local Ctrl+Z. Body text only; frontmatter stays in the
 * Yjs meta map.
 */
export default function CodeMirrorEditor({
  doc,
  awareness,
  mode = "suggest",
  cleanView = false,
  onTextChange,
  className,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  mode?: DocMode;
  cleanView?: boolean;
  onTextChange?: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onTextChange);
  onChangeRef.current = onTextChange;
  // Live mode for the suggest filter, read at edit time so the editor never
  // rebuilds when the mode flips.
  const modeRef = useRef<DocMode>(mode);
  modeRef.current = mode;

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;

    const ytext = doc.getText("body");
    const undoManager = new Y.UndoManager(ytext);

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        wrapOnSelection,
        suggestMode(() => modeRef.current),
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...historyKeymap]),
        wrapKeymap,
        markdown(),
        EditorView.lineWrapping,
        criticMarkup,
        yCollab(ytext, awareness, { undoManager }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(ytext.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;
    onChangeRef.current?.(ytext.toString());

    return () => {
      view.destroy();
      viewRef.current = null;
      undoManager.destroy();
    };
  }, [doc, awareness]);

  // Clean view hides CriticMarkup delimiters (reuses the `.clean-view` CSS).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dom.classList.toggle("clean-view", cleanView);
  }, [cleanView]);

  return <div ref={ref} className={className} />;
}
