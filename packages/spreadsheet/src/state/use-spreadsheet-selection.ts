"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SpreadsheetProps, SpreadsheetSelection } from "../props";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { notifySpreadsheetHost } from "./notifications";
import { axisSelectionRange, clampPosition, clampSelection, createSelection, initialSheetSelection, selectionForSheet, selectionRanges, toggleRangeSelection } from "./selection";
import type { Position, ReportError, SelectionUpdate, Workbook } from "./types";
import type { SpreadsheetHistoryTarget } from "./history-target";

/** Owns cell and object selection plus view focus; editing and persistence are coordinated by the caller. */
export function useSpreadsheetSelection(workbook: Workbook, features: SpreadsheetFeatureSettings,
  reportError: ReportError, propsRef: RefObject<SpreadsheetProps>) {
  const [selection, setSelectionState] = useState<SpreadsheetSelection>(() => initialSheetSelection(workbook.sheets[0]));
  const selectionRef = useRef(selection);
  const setSelection = useCallback((update: SelectionUpdate) => {
    const next = typeof update === "function" ? update(selectionRef.current) : update;
    selectionRef.current = next;
    setSelectionState(next);
  }, []);
  const [gridFocusRequest, setGridFocusRequest] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [drawingSelection, setDrawingSelection] = useState<{ sheetId: string; id: string } | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const activeSheet = workbook.sheets.find(sheet => sheet.id === selection.sheetId) ?? workbook.sheets[0];
  const selectedDrawing = drawingSelection?.sheetId === activeSheet.id
    ? activeSheet.drawings?.find(drawing => drawing.id === drawingSelection.id &&
      (drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes))
    : undefined;
  const selectedDrawingId = selectedDrawing?.id ?? null;
  const clearDrawingSelection = useCallback(() => setDrawingSelection(null), []);

  useEffect(() => {
    notifySpreadsheetHost(propsRef.current.onSelectionChange,
      createSelection(selection.sheetId, selectionRanges(selection), selection.focus));
    notifySpreadsheetHost(propsRef.current.onEvent, { type: "selection",
      selection: createSelection(selection.sheetId, selectionRanges(selection), selection.focus) });
  }, [selection, propsRef]);
  useEffect(() => {
    notifySpreadsheetHost(propsRef.current.onEvent, { type: "drawing-selection", sheetId: activeSheet.id, drawingId: selectedDrawingId });
  }, [activeSheet.id, selectedDrawingId, propsRef]);

  const selectAxisRange = (kind: "row" | "column", anchor: number, focus: number, additive = false, extend = false): boolean => {
    const range = axisSelectionRange(activeSheet, kind, anchor, focus);
    try {
      setSelection(old => selectionForSheet(activeSheet,
        extend ? [...selectionRanges(old).slice(0, -1), range] : additive ? [...selectionRanges(old), range] : [range], false, range.focus));
      clearDrawingSelection(); return true;
    } catch (cause) { reportError(cause); return false; }
  };
  const toggleAxisRange = (kind: "row" | "column", anchor: number, focus = anchor): boolean => {
    const range = axisSelectionRange(activeSheet, kind, anchor, focus);
    try {
      setSelection(old => {
        const toggled = toggleRangeSelection(old, range);
        return selectionForSheet(activeSheet, selectionRanges(toggled), false, toggled.focus);
      });
      clearDrawingSelection(); return true;
    } catch (cause) { reportError(cause); return false; }
  };
  const select = (position: Position, extend = false, additive = false): boolean => {
    const next = clampPosition(position, activeSheet);
    const active = selectionRanges(selectionRef.current).at(-1)!;
    if (extend && active.kind) return selectAxisRange(active.kind, active.anchor[active.kind], next[active.kind], additive, true);
    try { setSelection(old => {
      const previous = selectionRanges(old);
      const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: extend ? old.anchor : next, focus: next }]))[0];
      return selectionForSheet(activeSheet, extend ? [...previous.slice(0, -1), range] : additive ? [...previous, range] : [range], false, next);
    }); clearDrawingSelection(); return true; } catch (cause) { reportError(cause); return false; }
  };
  const selectRange = (anchor: Position, focus: Position, additive = false, extend = false): boolean => {
    const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: clampPosition(anchor, activeSheet), focus: clampPosition(focus, activeSheet) }]))[0];
    try { setSelection(old => selectionForSheet(activeSheet,
      extend ? [...selectionRanges(old).slice(0, -1), range] : additive ? [...selectionRanges(old), range] : [range], false, clampPosition(focus, activeSheet))); clearDrawingSelection(); return true; }
    catch (cause) { reportError(cause); return false; }
  };
  const toggleSelectionRange = (anchor: Position, focus: Position): boolean => {
    const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: clampPosition(anchor, activeSheet), focus: clampPosition(focus, activeSheet) }]))[0];
    try { setSelection(old => {
      const toggled = selectionRanges(toggleRangeSelection(old, range));
      const singleCell = toggled.length === 1 && toggled[0].anchor.row === toggled[0].focus.row && toggled[0].anchor.column === toggled[0].focus.column;
      return selectionForSheet(activeSheet, toggled, singleCell);
    }); clearDrawingSelection(); return true; }
    catch (cause) { reportError(cause); return false; }
  };
  const toggleSelection = (position: Position) => toggleSelectionRange(position, position);
  const selectDrawing = (id: string | null) => {
    setDrawingSelection(id ? { sheetId: activeSheet.id, id } : null);
    if (id) setCommentOpen(false);
  };
  const switchSheet = (id: string, currentWorkbook: Workbook) => {
    clearDrawingSelection();
    setCommentOpen(false);
    const sheet = currentWorkbook.sheets.find(item => item.id === id);
    if (sheet) setSelection(initialSheetSelection(sheet));
  };
  const selectRangeInSheet = (sheetId: string, anchor: Position, focus: Position, currentWorkbook = workbook,
    activeFocus?: Position, kind?: "row" | "column"): boolean => {
    const sheet = currentWorkbook.sheets.find(item => item.id === sheetId);
    if (!sheet || (!features.sheets && sheet.id !== activeSheet.id)) return false;
    try {
      const start = clampPosition(anchor, sheet), target = clampPosition(focus, sheet);
      setSelection(selectionForSheet(sheet, [{ anchor: start, focus: target, ...(kind ? { kind } : {}) }], false, clampPosition(activeFocus ?? start, sheet)));
      clearDrawingSelection();
      setCommentOpen(false);
      return true;
    } catch (cause) { reportError(cause); return false; }
  };
  const selectCellInSheet = (sheetId: string, position: Position): boolean => selectRangeInSheet(sheetId, position, position);
  const resetForWorkbook = (next: Workbook, options?: { preserveFocus?: boolean; historyTarget?: SpreadsheetHistoryTarget | null }) => {
    setCommentOpen(false);
    setViewRevision(value => value + 1);
    const previous = selectionRef.current;
    const target = options?.historyTarget;
    const targetSheet = target && next.sheets.find(sheet => sheet.id === target.sheetId);
    if (target && targetSheet && (features.sheets || targetSheet.id === previous.sheetId)) {
      const focus = clampPosition(target.focus, targetSheet);
      setSelection(selectionForSheet(targetSheet, target.ranges ?? [{ anchor: focus, focus }], true, focus));
      const drawing = target.drawingId && targetSheet.drawings?.find(item => item.id === target.drawingId &&
        (item.type === "image" ? features.images : item.type === "shape" ? features.shapes : features.textBoxes));
      setDrawingSelection(drawing ? { sheetId: targetSheet.id, id: drawing.id } : null);
      return;
    }
    const sheet = next.sheets.find(item => item.id === previous.sheetId) ?? next.sheets[0];
    if (!options?.preserveFocus || sheet.id !== previous.sheetId) {
      clearDrawingSelection();
      setSelection(initialSheetSelection(sheet));
    }
    else {
      // Structural changes have no stable cell target. Keep the valid parts of
      // the selection while clamping deleted rows, columns and restored merges.
      setDrawingSelection(current => current?.sheetId === sheet.id && sheet.drawings?.some(drawing => drawing.id === current.id &&
        (drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes)) ? current : null);
      try { setSelection(clampSelection(previous, next)); }
      catch {
        // Restored merges can exhaust the range limit when clampSelection adds
        // fragments. Expanding the original ranges keeps their count bounded.
        setSelection(selectionForSheet(sheet, selectionRanges(previous).map(range => ({
          ...range, anchor: clampPosition(range.anchor, sheet), focus: clampPosition(range.focus, sheet),
        })), true, clampPosition(previous.focus, sheet)));
      }
    }
  };

  return { activeSheet, selection, selectionRef, setSelection, select, selectRange, selectAxisRange, toggleAxisRange, toggleSelection, toggleSelectionRange, viewRevision,
    selectedDrawing, selectedDrawingId, selectDrawing, clearDrawingSelection, switchSheet, selectCellInSheet, selectRangeInSheet, resetForWorkbook,
    commentOpen: features.comments && commentOpen, setCommentOpen,
    gridFocusRequest, requestGridFocus: () => setGridFocusRequest(value => value + 1) };
}
