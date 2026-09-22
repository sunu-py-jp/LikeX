"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { SpreadsheetProps, SpreadsheetSelection, SpreadsheetSelectionRange as SpreadsheetPropsSelectionRange } from "../props";
import { resolveSpreadsheetFeatures, type SpreadsheetFeatureSettings } from "../api/resolve-features";
import type { SpreadsheetSelectionApi, SpreadsheetSelectionOptions } from "../api/selection";
import { resolveViewSelection, type ViewSelectionTarget } from "./view-selection";
import { notifySpreadsheetHost } from "./notifications";
import { axisSelectionRange, clampPosition, clampSelection, createSelection, initialSheetSelection, selectionForSheet, selectionRanges, toggleRangeSelection } from "./selection";
import type { Position, ReportError, SelectionUpdate, Workbook } from "./types";
import type { SpreadsheetHistoryTarget } from "./history-target";

/** Owns cell and object selection plus view focus; editing and persistence are coordinated by the caller. */
export function useSpreadsheetSelection(workbook: Workbook, features: SpreadsheetFeatureSettings,
  reportError: ReportError, propsRef: RefObject<SpreadsheetProps>, getWorkbook: () => Workbook, canChange: () => boolean) {
  const [selection, setSelectionState] = useState<SpreadsheetSelection>(() => initialSheetSelection(workbook.sheets[0]));
  const selectionRef = useRef(selection);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [navigation, setNavigation] = useState<{ selection: SpreadsheetSelection; reveal: boolean; focus: boolean } | null>(null);
  const [gridRevealRequest, setGridRevealRequest] = useState(0);
  const setSelection = useCallback((update: SelectionUpdate) => {
    const next = typeof update === "function" ? update(selectionRef.current) : update;
    setNavigation(null);
    selectionRef.current = next;
    setSelectionState(next);
  }, []);
  const [gridFocusRequest, setGridFocusRequest] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [drawingSelection, setDrawingSelection] = useState<{ sheetId: string; id: string } | null>(null);
  const drawingSelectionRef = useRef(drawingSelection);
  const updateDrawingSelection = (next: typeof drawingSelection) => { drawingSelectionRef.current = next; setDrawingSelection(next); };
  const [commentOpen, setCommentOpen] = useState(false);
  const activeSheet = workbook.sheets.find(sheet => sheet.id === selection.sheetId) ?? workbook.sheets[0];
  const selectedDrawing = drawingSelection?.sheetId === activeSheet.id
    ? activeSheet.drawings?.find(drawing => drawing.id === drawingSelection.id &&
      (drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes))
    : undefined;
  const selectedDrawingId = selectedDrawing?.id ?? null;
  const clearDrawingSelection = useCallback(() => { drawingSelectionRef.current = null; setDrawingSelection(null); }, []);

  useEffect(() => {
    notifySpreadsheetHost(propsRef.current.onSelectionChange,
      createSelection(selection.sheetId, selectionRanges(selection), selection.focus));
    notifySpreadsheetHost(propsRef.current.onEvent, { type: "selection",
      selection: createSelection(selection.sheetId, selectionRanges(selection), selection.focus) });
  }, [selection, propsRef]);
  useEffect(() => {
    notifySpreadsheetHost(propsRef.current.onEvent, { type: "drawing-selection", sheetId: activeSheet.id, drawingId: selectedDrawingId });
  }, [activeSheet.id, selectedDrawingId, propsRef]);

  const applySelection = (target: ViewSelectionTarget, options?: SpreadsheetSelectionOptions, external = false): boolean => {
    if (!mounted.current || !canChange()) return false;
    try {
      if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) ||
        Object.keys(options).some(key => key !== "reveal") || (options.reveal !== undefined && typeof options.reveal !== "boolean"))) return false;
      const next = resolveViewSelection(getWorkbook(), selectionRef.current, target, resolveSpreadsheetFeatures(propsRef.current.features));
      const reveal = options?.reveal ?? !external;
      const previousSheetId = selectionRef.current.sheetId;
      setSelection(next.selection);
      setNavigation({ selection: next.selection, reveal, focus: !external });
      updateDrawingSelection(next.drawingId ? { sheetId: next.selection.sheetId, id: next.drawingId } : null);
      if (next.drawingId || target.type === "sheet" || next.selection.sheetId !== previousSheetId) setCommentOpen(false);
      if (external && reveal) setGridRevealRequest(value => value + 1);
      return true;
    } catch (cause) { if (!external) reportError(cause); return false; }
  };
  const currentSheet = () => getWorkbook().sheets.find(sheet => sheet.id === selectionRef.current.sheetId)!;
  const applyRanges = (ranges: readonly SpreadsheetPropsSelectionRange[], focus?: Position, expand = true) =>
    applySelection({ type: "ranges", sheetId: selectionRef.current.sheetId, ranges, focus, expand });
  const selectAxisRange = (kind: "row" | "column", anchor: number, focus: number, additive = false, extend = false): boolean => {
    const range = axisSelectionRange(currentSheet(), kind, anchor, focus), previous = selectionRanges(selectionRef.current);
    return applyRanges(extend ? [...previous.slice(0, -1), range] : additive ? [...previous, range] : [range], range.focus, false);
  };
  const toggleAxisRange = (kind: "row" | "column", anchor: number, focus = anchor): boolean => {
    try {
      const toggled = toggleRangeSelection(selectionRef.current, axisSelectionRange(currentSheet(), kind, anchor, focus));
      return applyRanges(selectionRanges(toggled), toggled.focus, false);
    } catch (cause) { reportError(cause); return false; }
  };
  const select = (position: Position, extend = false, additive = false): boolean => {
    const sheet = currentSheet(), current = selectionRef.current, next = clampPosition(position, sheet), previous = selectionRanges(current), active = previous.at(-1)!;
    if (extend && active.kind) return selectAxisRange(active.kind, active.anchor[active.kind], next[active.kind], additive, true);
    const range = selectionRanges(selectionForSheet(sheet, [{ anchor: extend ? current.anchor : next, focus: next }]))[0];
    return applyRanges(extend ? [...previous.slice(0, -1), range] : additive ? [...previous, range] : [range], next, false);
  };
  const selectRange = (anchor: Position, focus: Position, additive = false, extend = false): boolean => {
    const sheet = currentSheet(), previous = selectionRanges(selectionRef.current), target = clampPosition(focus, sheet);
    const range = selectionRanges(selectionForSheet(sheet, [{ anchor: clampPosition(anchor, sheet), focus: target }]))[0];
    return applyRanges(extend ? [...previous.slice(0, -1), range] : additive ? [...previous, range] : [range], target, false);
  };
  const toggleSelectionRange = (anchor: Position, focus: Position): boolean => {
    try {
      const sheet = currentSheet(), range = selectionRanges(selectionForSheet(sheet, [{ anchor: clampPosition(anchor, sheet), focus: clampPosition(focus, sheet) }]))[0];
      const toggled = selectionRanges(toggleRangeSelection(selectionRef.current, range));
      const singleCell = toggled.length === 1 && toggled[0].anchor.row === toggled[0].focus.row && toggled[0].anchor.column === toggled[0].focus.column;
      return applyRanges(toggled, undefined, singleCell);
    } catch (cause) { reportError(cause); return false; }
  };
  const toggleSelection = (position: Position) => toggleSelectionRange(position, position);
  const selectDrawing = (id: string | null) => applySelection(id
    ? { type: "drawing", sheetId: selectionRef.current.sheetId, drawingId: id } : { type: "drawing.clear" });
  const switchSheet = (id: string) => applySelection({ type: "sheet", sheetId: id });
  const selectRangeInSheet = (sheetId: string, anchor: Position, focus: Position, currentWorkbook = getWorkbook(),
    activeFocus?: Position, kind?: "row" | "column"): boolean => {
    const sheet = currentWorkbook.sheets.find(item => item.id === sheetId);
    if (!sheet) return false;
    const start = clampPosition(anchor, sheet), target = clampPosition(focus, sheet);
    return applySelection({ type: "ranges", sheetId, ranges: [{ anchor: start, focus: target, ...(kind ? { kind } : {}) }],
      focus: clampPosition(activeFocus ?? start, sheet), expand: false });
  };
  const selectCellInSheet = (sheetId: string, position: Position): boolean => selectRangeInSheet(sheetId, position, position);
  const selectionApi: SpreadsheetSelectionApi = {
    getSelection: () => createSelection(selectionRef.current.sheetId, selectionRanges(selectionRef.current), selectionRef.current.focus),
    getSelectedDrawing: () => {
      const selected = drawingSelectionRef.current;
      if (!selected) return null;
      try { resolveViewSelection(getWorkbook(), selectionRef.current, { type: "drawing", sheetId: selected.sheetId, drawingId: selected.id }, resolveSpreadsheetFeatures(propsRef.current.features)); }
      catch { return null; }
      return { sheetId: selected.sheetId, drawingId: selected.id };
    },
    selectSheet: (sheetId, options) => applySelection({ type: "sheet", sheetId }, options, true),
    selectCell: (sheetId, position, options) => applySelection({ type: "ranges", sheetId, ranges: [{ anchor: position, focus: position }] }, options, true),
    selectRange: (sheetId, range, options) => applySelection({ type: "ranges", sheetId, ranges: [range] }, options, true),
    selectRanges: (sheetId, ranges, options) => applySelection({ type: "ranges", sheetId, ranges }, options, true),
    selectRows: (sheetId, start, end = start, options) => applySelection({ type: "row", sheetId, start, end }, options, true),
    selectColumns: (sheetId, start, end = start, options) => applySelection({ type: "column", sheetId, start, end }, options, true),
    selectDrawing: (sheetId, drawingId, options) => applySelection({ type: "drawing", sheetId, drawingId }, options, true),
    clearSelection: options => applySelection({ type: "clear" }, options, true),
    revealSelection: () => {
      if (!mounted.current || !canChange()) return false;
      setGridRevealRequest(value => value + 1); return true;
    },
  };
  const resetForWorkbook = (next: Workbook, options?: { preserveFocus?: boolean; historyTarget?: SpreadsheetHistoryTarget | null }) => {
    setCommentOpen(false);
    setViewRevision(value => value + 1);
    const previous = selectionRef.current;
    const target = options?.historyTarget;
    const targetSheet = target && next.sheets.find(sheet => sheet.id === target.sheetId);
    if (target && !targetSheet) {
      clearDrawingSelection();
      setSelection(initialSheetSelection(next.sheets[0]));
      return;
    }
    if (target && targetSheet && (features.sheets || targetSheet.id === previous.sheetId)) {
      const focus = clampPosition(target.focus, targetSheet);
      const ranges = (target.ranges ?? [{ anchor: focus, focus }]).map(range => ({ ...range,
        anchor: clampPosition(range.anchor, targetSheet), focus: clampPosition(range.focus, targetSheet),
      }));
      setSelection(selectionForSheet(targetSheet, ranges, true, focus));
      const drawing = target.drawingId && targetSheet.drawings?.find(item => item.id === target.drawingId &&
        (item.type === "image" ? features.images : item.type === "shape" ? features.shapes : features.textBoxes));
      updateDrawingSelection(drawing ? { sheetId: targetSheet.id, id: drawing.id } : null);
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
      const current = drawingSelectionRef.current;
      updateDrawingSelection(current?.sheetId === sheet.id && sheet.drawings?.some(drawing => drawing.id === current.id &&
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

  return { selectionApi, gridRevealRequest, selectionFocus: navigation?.selection === selection ? navigation.focus : true,
    selectionReveal: navigation?.selection === selection ? navigation.reveal : true,
    activeSheet, selection, selectionRef, setSelection, select, selectRange, selectAxisRange, toggleAxisRange, toggleSelection, toggleSelectionRange, viewRevision,
    selectedDrawing, selectedDrawingId, selectDrawing, clearDrawingSelection, switchSheet, selectCellInSheet, selectRangeInSheet, resetForWorkbook,
    commentOpen: features.comments && commentOpen, setCommentOpen,
    gridFocusRequest, requestGridFocus: () => setGridFocusRequest(value => value + 1) };
}
