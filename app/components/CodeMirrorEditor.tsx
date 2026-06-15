import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

/**
 * Y.Text core (#13, spike). A CodeMirror 6 editor bound to `doc.getText("body")`
 * via y-codemirror.next, so the markdown source IS the CRDT. Collaborative
 * cursors and selections come from the binding (no separate caret extension);
 * undo/redo is the Yjs UndoManager, so a remote edit does not get undone by a
 * local Ctrl+Z. This is body text only; frontmatter stays in the Yjs meta map.
 */
export default function CodeMirrorEditor({
  doc,
  awareness,
  onTextChange,
  className,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  onTextChange?: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onTextChange);
  onChangeRef.current = onTextChange;

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;

    const ytext = doc.getText("body");
    // Track only this client's edits for undo, so Ctrl+Z never reverts a
    // collaborator's change.
    const undoManager = new Y.UndoManager(ytext);

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        yCollab(ytext, awareness, { undoManager }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(ytext.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    // Surface the seeded text once on mount.
    onChangeRef.current?.(ytext.toString());

    return () => {
      view.destroy();
      undoManager.destroy();
    };
  }, [doc, awareness]);

  return <div ref={ref} className={className} />;
}
