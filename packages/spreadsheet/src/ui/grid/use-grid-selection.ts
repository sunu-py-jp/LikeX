"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import type { SpreadsheetController, Position } from "../../state/use-spreadsheet";
import { isCellSelected, isRangeSelected } from "../../state/selection";
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
        else latest.current.toggleSelectionRange(drag.toggleOnClick.anchor, drag.toggleOnClick.focus);
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
    const range = kind === "row"
      ? { anchor: { row: origin.row, column: c.activeSheet.columnCount - 1 }, focus: { row: position.row, column: 0 } }
      : kind === "column"
        ? { anchor: { row: c.activeSheet.rowCount - 1, column: origin.column }, focus: { row: 0, column: position.column } }
        : { anchor: position, focus: position };
    const alreadySelected = kind === "cell" ? isCellSelected(c.selection, position) : isRangeSelected(c.selection, range);
    const toggleOnClick = additive && alreadySelected ? range : undefined;
    if (!toggleOnClick) {
      const accepted = kind === "cell" ? c.select(position, shiftKey, additive)
        : c.selectRange(range.anchor, range.focus, additive, shiftKey);
      if (!accepted) return;
    }
    dragging.current = pointer.down ? { kind, pointerId: pointer.id, origin, toggleOnClick } : null;
    if (!pointer.down && toggleOnClick) {
      if (kind === "cell") c.toggleSelection(toggleOnClick.focus);
      else c.toggleSelectionRange(toggleOnClick.anchor, toggleOnClick.focus);
    }
    focusIntentRef.current = true;
    c.requestGridFocus();
    scrollerRef.current?.focus({ preventScroll: true });
    if (position.row === c.selection.focus.row && position.column === c.selection.focus.column) {
      activeInputRef.current?.focus({ preventScroll: true }); activeInputRef.current?.select(); focusIntentRef.current = false;
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
      if (drag.kind === "row") accepted = c.selectRange({ row: drag.origin.row, column: c.activeSheet.columnCount - 1 }, { row: position.row, column: 0 }, true);
      else if (drag.kind === "column") accepted = c.selectRange({ row: c.activeSheet.rowCount - 1, column: drag.origin.column }, { row: 0, column: position.column }, true);
      else accepted = c.selectRange(drag.origin, position, true);
      if (accepted) drag.toggleOnClick = undefined;
    } else if (drag.kind === "row") accepted = c.select({ row: position.row, column: 0 }, true);
    else if (drag.kind === "column") accepted = c.select({ row: 0, column: position.column }, true);
    else accepted = c.select(position, true);
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
    const anchor = kind === "row" ? { row: origin.row, column: c.activeSheet.columnCount - 1 } : { row: c.activeSheet.rowCount - 1, column: origin.column };
    const focus = kind === "row" ? { row: position.row, column: 0 } : { row: 0, column: position.column };
    if (additive) c.toggleSelectionRange(anchor, focus);
    else c.selectRange(anchor, focus, false, event.shiftKey);
    c.requestGridFocus();
    });
  };

  return { startSelection, extendSelection, selectHeaderWithKeyboard };
}
