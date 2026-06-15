import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { criticMarkup } from "~/lib/cm-criticmarkup";
import { markdownLineStyle } from "~/lib/cm-markdown-style";
import { fencedDivStyle } from "~/lib/cm-fenced-divs";
import { suggestMode } from "~/lib/cm-suggest";
import { wrapKeymap, wrapOnSelection } from "~/lib/cm-shortcuts";
import { activeCommentField, setActiveComment } from "~/lib/cm-active-comment";
import { citations } from "~/lib/cm-citations";
import type { BibLibrary } from "~/lib/citations";
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
  activeComment = null,
  bibLibrary = null,
  onTextChange,
  onCursorChange,
  onViewReady,
  className,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  mode?: DocMode;
  cleanView?: boolean;
  activeComment?: { from: number; to: number } | null;
  bibLibrary?: BibLibrary | null;
  onTextChange?: (text: string) => void;
  onCursorChange?: (offset: number) => void;
  onViewReady?: (view: EditorView | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onTextChange);
  onChangeRef.current = onTextChange;
  const onCursorRef = useRef(onCursorChange);
  onCursorRef.current = onCursorChange;
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;
  // Live mode for the suggest filter, read at edit time so the editor never
  // rebuilds when the mode flips.
  const modeRef = useRef<DocMode>(mode);
  modeRef.current = mode;
  // Live bib library for the @-picker, read at completion time so the editor
  // never rebuilds when the library loads.
  const bibRef = useRef<BibLibrary | null>(bibLibrary);
  bibRef.current = bibLibrary;

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
        highlightActiveLineGutter(),
        history(),
        // Editor helpers: multi-cursor (Alt-click, Mod-D next occurrence,
        // Alt-drag rectangular), bracket match/close, selection-match
        // highlighting, drag-drop cursor.
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        wrapOnSelection,
        suggestMode(() => modeRef.current),
        keymap.of([
          ...closeBracketsKeymap,
          ...yUndoManagerKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        wrapKeymap,
        markdown(),
        EditorView.lineWrapping,
        citations(() => bibRef.current),
        markdownLineStyle,
        fencedDivStyle,
        criticMarkup,
        activeCommentField,
        yCollab(ytext, awareness, { undoManager }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(ytext.toString());
          if (u.docChanged || u.selectionSet) onCursorRef.current?.(u.state.selection.main.head);
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;
    onChangeRef.current?.(ytext.toString());
    onViewReadyRef.current?.(view);

    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
      undoManager.destroy();
    };
  }, [doc, awareness]);

  // Reflect the active comment range (from the panel or cursor) as a tint.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setActiveComment.of(activeComment) });
  }, [activeComment]);

  // Clean view hides CriticMarkup delimiters (reuses the `.clean-view` CSS).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dom.classList.toggle("clean-view", cleanView);
  }, [cleanView]);

  return <div ref={ref} className={className} />;
}
