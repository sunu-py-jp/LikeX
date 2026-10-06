"use client";

import { useEffect, useLayoutEffect, useRef, type Ref, useImperativeHandle } from "react";
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { documentSchema, getDocumentText } from "../model/index";
import { createDocumentDragFeedback } from "./document-drag-feedback";
import type { DocumentEditor } from "../state/use-document-editor";

export type DocumentSurfaceHandle = { getState(): EditorState | undefined; dispatch(transaction: Transaction): void; focus(): void };
export function DocumentSurface({ editor, surfaceRef, onViewChange }: { editor: DocumentEditor; surfaceRef: Ref<DocumentSurfaceHandle>; onViewChange(): void }) {
  const container = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), latest = useRef(editor), changed = useRef(onViewChange);
  useLayoutEffect(() => { latest.current = editor; changed.current = onViewChange; });
  const dragFeedback = useRef<ReturnType<typeof createDocumentDragFeedback> | null>(null);
  const lastPageReveal = useRef<DocumentEditor["pageReveal"]>(null);
  function syncView() {
    dragFeedback.current?.check();
    const current = view.current; if (!current) return;
    const snapshot = latest.current.session.getSnapshot(), doc = documentSchema.nodeFromJSON(snapshot.document.content);
    let transaction = current.state.tr;
    if (!doc.eq(current.state.doc)) transaction = transaction.replaceWith(0, current.state.doc.content.size, doc.content);
    const { from, to } = snapshot.selection;
    const reveal = latest.current.pageReveal;
    const pageTarget = !!reveal && reveal.document === snapshot.document && reveal.position === from && from === to;
    if (from !== transaction.selection.from || to !== transaction.selection.to) {
      const node = doc.nodeAt(from);
      if (pageTarget) transaction.setSelection(Selection.near(transaction.doc.resolve(from)));
      else if (from === 0 && to === doc.content.size) transaction.setSelection(new AllSelection(transaction.doc));
      else if (node && (node.isAtom || node.type.name === "table") && !node.isText && from + node.nodeSize === to) transaction.setSelection(NodeSelection.create(transaction.doc, from));
      else transaction.setSelection(TextSelection.between(transaction.doc.resolve(from), transaction.doc.resolve(to)));
    }
    const shouldReveal = !!reveal && reveal !== lastPageReveal.current && reveal.document === snapshot.document;
    if (shouldReveal) transaction.scrollIntoView();
    const changedState = transaction.docChanged || transaction.selectionSet || shouldReveal;
    current.updateState(changedState ? current.state.apply(transaction) : current.state);
    if (shouldReveal) {
      // ProseMirror skips scrollToSelection when the DOM selection is outside the editor.
      // An external/read-only navigation must reveal its position without taking focus.
      const viewport = current.dom.closest<HTMLElement>(".lxd-document-viewport");
      if (viewport) {
        const bounds = viewport.getBoundingClientRect(), target = current.coordsAtPos(current.state.selection.from, 1);
        viewport.scrollTop += target.top - bounds.top - viewport.clientTop - 12;
        if (target.left < bounds.left || target.right > bounds.right) viewport.scrollLeft += target.left - bounds.left - viewport.clientLeft - 12;
      }
      lastPageReveal.current = reveal;
    }
    if (changedState) changed.current();
    current.setProps({ editable: () => latest.current.editable && latest.current.features.text, decorations: state => {
      const active = latest.current.search.active;
      if (!latest.current.search.open || !active || !state.doc.eq(documentSchema.nodeFromJSON(latest.current.document.content))) return DecorationSet.empty;
      const { from, to } = active.match;
      const inline = active.kind === "paragraph" || active.kind === "heading";
      return DecorationSet.create(state.doc, [inline ? Decoration.inline(from, to, { class: "lxd-search-highlight" }) : Decoration.node(from, to, { class: "lxd-search-highlight" })]);
    } });
  }
  useImperativeHandle(surfaceRef, () => ({ getState: () => view.current?.state, dispatch: transaction => view.current?.dispatch(transaction), focus: () => view.current?.focus() }));
  useEffect(() => {
    if (!container.current) return;
    const plugins = [keymap({ Enter: chainCommands(splitListItem(documentSchema.nodes.list_item), baseKeymap.Enter), Tab: sinkListItem(documentSchema.nodes.list_item), "Shift-Tab": liftListItem(documentSchema.nodes.list_item), "Mod-Enter": exitCode }), keymap(baseKeymap)];
    const pm = new EditorView(container.current, {
      state: EditorState.create({ schema: documentSchema, doc: documentSchema.nodeFromJSON(latest.current.document.content), plugins }),
      editable: () => latest.current.editable && latest.current.features.text,
      attributes: { class: "lxd-editor", role: "textbox", "aria-label": "文書本文", "aria-multiline": "true", spellcheck: "true" },
      dispatchTransaction(transaction) {
        if (!transaction.docChanged) {
          pm.updateState(pm.state.apply(transaction));
          changed.current();
          latest.current.select({ from: transaction.selection.from, to: transaction.selection.to }); return;
        }
        const before = latest.current.session.getSnapshot().document;
        const steps = transaction.steps.map(step => step.toJSON());
        const typing = !transaction.getMeta("paste") && !transaction.getMeta("uiEvent") && steps.every(step => step.stepType === "replace" && (!step.slice?.content || step.slice.content.every((node: { type: string }) => node.type === "text")));
        const pending = latest.current.execute({ type: "transaction.apply", steps, selection: { from: transaction.selection.from, to: transaction.selection.to } },
          { historyGroup: typing ? "typing" : undefined });
        if (latest.current.session.getSnapshot().document !== before) {
          pm.updateState(pm.state.apply(transaction)); syncView();
        }
        else pm.updateState(pm.state);
        void pending.then(() => { if (view.current === pm) { syncView(); changed.current(); } });
      },
      handleDOMEvents: { drop: (_view,event) => dragFeedback.current?.drop(event) ?? false },
      handleClick(_view, _pos, event) { if ((event.target as Element).closest("a")) { event.preventDefault(); return true; } return false; },
    });
    view.current = pm; dragFeedback.current = createDocumentDragFeedback(pm, () => latest.current);
    syncView();
    return () => { dragFeedback.current?.destroy(); dragFeedback.current = null; view.current = null; lastPageReveal.current = null; pm.destroy(); };
  }, []);
  useLayoutEffect(syncView, [editor.document, editor.selection, editor.editable, editor.features.text, editor.features.images, editor.features.shapes, editor.pageReveal, editor.search.active, editor.search.open]);
  return <div className="lxd-surface"><div ref={container} /><div className="lxd-ssr-content" aria-hidden="true">{getDocumentText(editor.document)}</div></div>;
}
