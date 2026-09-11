"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import type { SpreadsheetController, Position } from "../../state/use-spreadsheet";
import { axisSelectionRange, isCellSelected, isRangeSelected } from "../../state/selection";
import { blurObjectEditor } from "../../state/blur-object-editor";
import type { GridFocusRefs } from "./use-grid-focus";

type SelectionDrag = {
  kind: "cell" | "row" | "column";
  pointerId: number;
  origin: Position;
  toggleOnClick?: { anchor: Position; focus: Position };
};

/** Owns pointer gesture lifetime and header activation, including additive selection. */
export function useGridSelection(c: SpreadsheetController, { scrollerRef, activeInputRef, focusIntentRef }: GridFocusRefs) {
  const dragging = useRef<SelectionDrag | null>(null);
  const pendingPointer = useRef<{ id: number; down: boolean } | null>(null);
  const latest = useRef(c);
  useLayoutEffect(() => { latest.current = c; });
  useEffect(() => {
    const document = scrollerRef.current?.ownerDocument;
    if (!document) return;
    const finish = (event: globalThis.PointerEvent) => {
      if (pendingPointer.current?.id === event.pointerId) pendingPointer.current.down = false;
      const drag = dragging.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragging.current = null;
      if (drag.toggleOnClick) {
        if (drag.kind === "cell") latest.current.toggleSelection(drag.toggleOnClick.focus);
        else latest.current.toggleAxisRange(drag.kind, drag.toggleOnClick.anchor[drag.kind], drag.toggleOnClick.focus[drag.kind]);
        latest.current.requestGridFocus();
      }
    };
    const cancel = () => { dragging.current = null; pendingPointer.current = null; };
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    document.defaultView?.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      document.defaultView?.removeEventListener("blur", cancel);
    };
  }, [scrollerRef]);
  useEffect(() => { dragging.current = null; pendingPointer.current = null; }, [c.activeSheet.id]);

  const startSelection = (event: PointerEvent<HTMLElement>, position: Position, kind: SelectionDrag["kind"]) => {
    if (event.button !== 0) return;
    dragging.current = null;
    blurObjectEditor(event.currentTarget);
    event.preventDefault();
    const pointer = { id: event.pointerId, down: true };
    pendingPointer.current = pointer;
    const { shiftKey, ctrlKey, metaKey, altKey } = event;
    c.afterCommit(() => {
    if (pendingPointer.current !== pointer || latest.current.activeSheet.id !== c.activeSheet.id) return;
    const additive = (ctrlKey || metaKey) && !altKey && !shiftKey;
    const origin = shiftKey ? c.selection.anchor : position;
    const range = kind === "cell" ? { anchor: position, focus: position } : axisSelectionRange(c.activeSheet, kind, origin[kind], position[kind]);
    const alreadySelected = kind === "cell" ? isCellSelected(c.selection, position) : isRangeSelected(c.selection, range);
    const toggleOnClick = additive && alreadySelected ? range : undefined;
    if (!toggleOnClick) {
      const accepted = kind === "cell" ? c.select(position, shiftKey, additive)
        : c.selectAxisRange(kind, origin[kind], position[kind], additive, shiftKey);
      if (!accepted) return;
    }
    dragging.current = pointer.down ? { kind, pointerId: pointer.id, origin, toggleOnClick } : null;
    if (!pointer.down && toggleOnClick) {
      if (kind === "cell") c.toggleSelection(toggleOnClick.focus);
      else c.toggleAxisRange(kind, toggleOnClick.anchor[kind], toggleOnClick.focus[kind]);
    }
    focusIntentRef.current = true;
    c.requestGridFocus();
    scrollerRef.current?.focus({ preventScroll: true });
    if (position.row === c.selection.focus.row && position.column === c.selection.focus.column) {
      activeInputRef.current?.focus({ preventScroll: true }); activeInputRef.current?.setSelectionRange(0, 0); focusIntentRef.current = false;
    }
    });
  };
  const extendSelection = (event: PointerEvent<HTMLElement>, position: Position) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Re-entry after releasing outside the document must not continue a stale drag.
    if (!(event.buttons & 1)) { dragging.current = null; return; }
    let accepted: boolean;
    if (drag.toggleOnClick) {
      if (drag.kind === "row" ? position.row === drag.origin.row : drag.kind === "column" ? position.column === drag.origin.column : position.row === drag.origin.row && position.column === drag.origin.column) return;
      if (drag.kind === "cell") accepted = c.selectRange(drag.origin, position, true);
      else accepted = c.selectAxisRange(drag.kind, drag.origin[drag.kind], position[drag.kind], true);
      if (accepted) drag.toggleOnClick = undefined;
    } else if (drag.kind === "cell") accepted = c.select(position, true);
    else accepted = c.selectAxisRange(drag.kind, drag.origin[drag.kind], position[drag.kind], false, true);
    // A rejected addition must never turn the next pointer event into an extension
    // of the previous active range, or a release into a pending deselection.
    if (!accepted) { dragging.current = null; focusIntentRef.current = false; return; }
    focusIntentRef.current = true;
  };
  const selectHeaderWithKeyboard = (event: { detail: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, position: Position, kind: "row" | "column") => {
    // Pointer selection is handled on pointerdown; detail=0 covers keyboard/AT activation.
    if (event.detail !== 0) return;
    pendingPointer.current = null;
    c.afterCommit(() => {
    focusIntentRef.current = true;
    const additive = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const origin = event.shiftKey ? c.selection.anchor : position;
    if (additive) c.toggleAxisRange(kind, origin[kind], position[kind]);
    else c.selectAxisRange(kind, origin[kind], position[kind], false, event.shiftKey);
    c.requestGridFocus();
    });
  };

  return { startSelection, extendSelection, selectHeaderWithKeyboard };
}
