import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
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
import { bracketMatching, codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { mistFolds } from "~/lib/cm-folding";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { criticMarkup } from "~/lib/cm-criticmarkup";
import { selectionToolbar } from "~/lib/cm-selection-toolbar";
import { markdownLineStyle } from "~/lib/cm-markdown-style";
import { livePreview } from "~/lib/cm-live-preview";
import { fencedDivStyle } from "~/lib/cm-fenced-divs";
import { suggestMode } from "~/lib/cm-suggest";
import { wrapKeymap, wrapOnSelection } from "~/lib/cm-shortcuts";
import { activeCommentField, setActiveComment } from "~/lib/cm-active-comment";
import { citationSource } from "~/lib/cm-citations";
import { classSource } from "~/lib/cm-classes";
import { slashSource, slashWrapSelection } from "~/lib/cm-slash";
import { iconSource } from "~/lib/cm-icons";
import { modAltChord } from "~/lib/chord";
import type { BibLibrary } from "~/lib/citations";
import type { DocMode } from "~/shared/types";

/**
 * Paste handler: when the clipboard holds an image (a screenshot, a copied
 * picture), upload it and insert `![](path)` at the cursor. A placeholder marks
 * the spot while the upload runs and is found by text (not position), so it
 * lands right even after concurrent edits. The dispatches carry no user event,
 * so suggest mode leaves them alone. Returns false for non-image pastes so text
 * paste is untouched.
 */
function handleImagePaste(
  event: ClipboardEvent,
  view: EditorView,
  onImagePaste: ((file: File) => Promise<string | null>) | undefined,
  markEdited: () => void,
): boolean {
  if (!onImagePaste) return false;
  const items = event.clipboardData?.items;
  if (!items) return false;
  const imageItem = Array.from(items).find((it) => it.kind === "file" && it.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return false;
  event.preventDefault();

  const marker = `![uploading ${Math.random().toString(36).slice(2, 8)}…]()`;
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: marker },
    selection: { anchor: sel.from + marker.length },
  });
  // The dispatches carry no userEvent, so nothing here counts as a user edit and
  // the save baseline would go on re-baselining: paste an image, and the picture
  // lands in the folder while the document never saves the line referring to it.
  // Say so directly instead.
  markEdited();

  void (async () => {
    let replacement = "";
    try {
      const path = await onImagePaste(file);
      replacement = path ? `![](${path})` : "";
    } catch {
      replacement = "";
    }
    const idx = view.state.doc.toString().indexOf(marker);
    if (idx >= 0) view.dispatch({ changes: { from: idx, to: idx + marker.length, insert: replacement } });
    markEdited();
  })();
  return true;
}

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
  canEdit = false,
  cleanView = false,
  live = false,
  resolveSrc,
  activeComment = null,
  bibLibrary = null,
  classList = null,
  lang = "en-GB",
  onTextChange,
  onCursorChange,
  onViewReady,
  onUserEdit,
  onImagePaste,
  onShortcut,
  className,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  mode?: DocMode;
  /** The user may apply edits (edit-link role): enables the selection toolbar's
   *  accept/reject and comment resolve/delete actions. */
  canEdit?: boolean;
  cleanView?: boolean;
  /** Live preview: hide the markdown syntax marks away from the cursor. */
  live?: boolean;
  /** Turn an image's markdown src into a loadable URL, for live preview's inline
   *  images. Same resolution the Preview pane uses. */
  resolveSrc?: (src: string) => string;
  activeComment?: { from: number; to: number } | null;
  bibLibrary?: BibLibrary | null;
  /** Pandoc class names from the deck CSS, for the `.`-class picker. */
  classList?: string[] | null;
  /** Spellcheck language (BCP-47, e.g. "en-GB"); turns on browser spellcheck. */
  lang?: string;
  onTextChange?: (text: string) => void;
  onCursorChange?: (offset: number) => void;
  onViewReady?: (view: EditorView | null) => void;
  /** Fired when the user themselves edits the doc (a transaction carrying a
   *  userEvent), as opposed to a remote Yjs sync update, so the save baseline can
   *  freeze on real input rather than on the load-time settle. */
  onUserEdit?: () => void;
  /** Upload a pasted image and return the markdown path to reference, or null
   *  to let the paste fall through (e.g. non-Drive docs). */
  onImagePaste?: (file: File) => Promise<string | null>;
  /** Run a mod+alt layout shortcut caught while the editor is focused; returns
   *  true if it was handled (so the key is consumed). */
  onShortcut?: (chord: string) => boolean;
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
  const onUserEditRef = useRef(onUserEdit);
  onUserEditRef.current = onUserEdit;
  const onImagePasteRef = useRef(onImagePaste);
  onImagePasteRef.current = onImagePaste;
  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;
  // Live mode for the suggest filter, read at edit time so the editor never
  // rebuilds when the mode flips.
  const modeRef = useRef<DocMode>(mode);
  modeRef.current = mode;
  // Live edit-permission flag, read when the selection toolbar is built so the
  // editor never rebuilds if the role were to change.
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  // Live bib library for the @-picker, read at completion time so the editor
  // never rebuilds when the library loads.
  const bibRef = useRef<BibLibrary | null>(bibLibrary);
  bibRef.current = bibLibrary;
  // Live class list for the `.`-picker, read at completion time so the editor
  // never rebuilds when the deck CSS loads.
  const classRef = useRef<string[]>(classList ?? []);
  classRef.current = classList ?? [];
  // Browser spellcheck, reconfigured (not rebuilt) when the language changes.
  const langCompRef = useRef<Compartment | null>(null);
  if (!langCompRef.current) langCompRef.current = new Compartment();
  const langRef = useRef(lang);
  langRef.current = lang;
  // Live preview, reconfigured (not rebuilt) when the View changes.
  const liveCompRef = useRef<Compartment | null>(null);
  if (!liveCompRef.current) liveCompRef.current = new Compartment();
  const liveRef = useRef(live);
  liveRef.current = live;
  // Read at decoration time, so the editor never rebuilds when the asset token
  // or the file's folder changes.
  const srcRef = useRef(resolveSrc);
  srcRef.current = resolveSrc;
  const liveExt = () => livePreview((s) => srcRef.current?.(s) ?? s);
  const spellcheckExt = (l: string) =>
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off", lang: l });
  // The two view-wide classes (clean view's hidden delimiters, live preview's
  // typography) go through CodeMirror's own attribute facet, NOT
  // `view.dom.classList`. CodeMirror rewrites that class attribute wholesale
  // whenever its own attributes change, so a foreign class is dropped the moment
  // the editor takes focus: click once and the styling vanishes.
  const attrsCompRef = useRef<Compartment | null>(null);
  if (!attrsCompRef.current) attrsCompRef.current = new Compartment();
  const cleanRef = useRef(cleanView);
  cleanRef.current = cleanView;
  const editorClasses = (clean: boolean, isLive: boolean) =>
    EditorView.editorAttributes.of({
      class: [clean ? "clean-view" : "", isLive ? "live-preview" : ""].filter(Boolean).join(" "),
    });

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;

    const ytext = doc.getText("body");
    const undoManager = new Y.UndoManager(ytext);

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        foldGutter(),
        codeFolding(),
        mistFolds,
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
        // Typing "/" over a selection wraps it as a styled span/div; with no
        // selection it falls through to the slash-command menu.
        slashWrapSelection,
        // Rebuild the slide preview now, without waiting out the debounce.
        // Ctrl/Cmd+S (and Ctrl/Cmd+Enter) ask for an immediate render; the deck
        // preview listens for the event. preventDefault stops the browser's save
        // dialog. Highest precedence so it beats any default binding.
        Prec.highest(
          keymap.of([
            {
              key: "Mod-s",
              mac: "Mod-s",
              preventDefault: true,
              run: () => (window.dispatchEvent(new CustomEvent("mist-rebuild-deck")), true),
            },
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => (window.dispatchEvent(new CustomEvent("mist-rebuild-deck")), true),
            },
          ]),
        ),
        suggestMode(() => modeRef.current),
        keymap.of([
          ...closeBracketsKeymap,
          ...yUndoManagerKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        wrapKeymap,
        // GFM base (not plain CommonMark) so tables and `~~strikethrough~~`
        // parse; live preview reads the same tree.
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        langCompRef.current!.of(spellcheckExt(langRef.current)),
        liveCompRef.current!.of(liveRef.current ? liveExt() : []),
        attrsCompRef.current!.of(editorClasses(cleanRef.current, liveRef.current)),
        autocompletion({
          override: [
            slashSource(),
            citationSource(() => bibRef.current),
            classSource(() => classRef.current),
            iconSource(),
          ],
          icons: false,
        }),
        markdownLineStyle,
        fencedDivStyle,
        criticMarkup,
        selectionToolbar(() => canEditRef.current),
        activeCommentField,
        EditorView.domEventHandlers({
          paste: (event, v) =>
            handleImagePaste(event, v, onImagePasteRef.current, () => onUserEditRef.current?.()),
          // Layout shortcuts: catch the chord here (e.code based) so a focused
          // editor never swallows it, then hand it to the layout.
          keydown: (event) => {
            const chord = modAltChord(event);
            if (chord && onShortcutRef.current?.(chord)) {
              event.preventDefault();
              // Stop it reaching the window listener, which would run it again.
              event.stopPropagation();
              return true;
            }
            return false;
          },
        }),
        yCollab(ytext, awareness, { undoManager }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current?.(ytext.toString());
            // A userEvent annotation means this client typed/edited; a remote Yjs
            // sync update carries none. Only real input freezes the save baseline.
            if (u.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined)) {
              onUserEditRef.current?.();
            }
          }
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

  // Clean view (hides CriticMarkup delimiters) and live preview both style the
  // whole editor through one class attribute, kept in step here.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !attrsCompRef.current) return;
    view.dispatch({ effects: attrsCompRef.current.reconfigure(editorClasses(cleanView, live)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanView, live]);

  // Live preview: swap the decoration extension in.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !liveCompRef.current) return;
    view.dispatch({ effects: liveCompRef.current.reconfigure(live ? liveExt() : []) });
  }, [live]);

  // Apply a language change (frontmatter `lang:`) without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !langCompRef.current) return;
    view.dispatch({ effects: langCompRef.current.reconfigure(spellcheckExt(lang)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return <div ref={ref} className={className} />;
}
