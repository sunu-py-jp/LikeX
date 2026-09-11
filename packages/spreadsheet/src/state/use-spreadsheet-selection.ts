"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SpreadsheetProps, SpreadsheetSelection } from "../props";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { notifySpreadsheetHost } from "./notifications";
import { clampPosition, clampSelection, createSelection, initialSheetSelection, selectionForSheet, selectionRanges, toggleRangeSelection } from "./selection";
import type { Position, ReportError, SelectionUpdate, Workbook } from "./types";

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

  const select = (position: Position, extend = false, additive = false): boolean => {
    const next = clampPosition(position, activeSheet);
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
  const selectRangeInSheet = (sheetId: string, anchor: Position, focus: Position, currentWorkbook = workbook): boolean => {
    const sheet = currentWorkbook.sheets.find(item => item.id === sheetId);
    if (!sheet || (!features.sheets && sheet.id !== activeSheet.id)) return false;
    try {
      const start = clampPosition(anchor, sheet), target = clampPosition(focus, sheet);
      setSelection(selectionForSheet(sheet, [{ anchor: start, focus: target }], false, start));
      clearDrawingSelection();
      setCommentOpen(false);
      return true;
    } catch (cause) { reportError(cause); return false; }
  };
  const selectCellInSheet = (sheetId: string, position: Position): boolean => selectRangeInSheet(sheetId, position, position);
  const resetForWorkbook = (next: Workbook, options?: { preserveFocus?: boolean }) => {
    setCommentOpen(false);
    setViewRevision(value => value + 1);
    const previous = selectionRef.current;
    const sheet = next.sheets.find(item => item.id === previous.sheetId) ?? next.sheets[0];
    if (!options?.preserveFocus || sheet.id !== previous.sheetId) {
      clearDrawingSelection();
      setSelection(initialSheetSelection(sheet));
    }
    else {
      // History replaces data, not the user's selection. Retain every range and
      // object that still exists, while clamping deleted rows, columns and merges.
      setDrawingSelection(current => current?.sheetId === sheet.id && sheet.drawings?.some(drawing => drawing.id === current.id &&
        (drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes)) ? current : null);
      try { setSelection(clampSelection(previous, next)); }
      catch {
        // Restored merges can exhaust the range limit when clampSelection adds
        // fragments. Expanding the original ranges keeps their count bounded.
        setSelection(selectionForSheet(sheet, selectionRanges(previous).map(range => ({
          anchor: clampPosition(range.anchor, sheet), focus: clampPosition(range.focus, sheet),
        })), true, clampPosition(previous.focus, sheet)));
      }
    }
  };

  return { activeSheet, selection, selectionRef, setSelection, select, selectRange, toggleSelection, toggleSelectionRange, viewRevision,
    selectedDrawing, selectedDrawingId, selectDrawing, clearDrawingSelection, switchSheet, selectCellInSheet, selectRangeInSheet, resetForWorkbook,
    commentOpen: features.comments && commentOpen, setCommentOpen,
    gridFocusRequest, requestGridFocus: () => setGridFocusRequest(value => value + 1) };
}
