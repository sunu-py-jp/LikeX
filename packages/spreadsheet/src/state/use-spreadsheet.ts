"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SpreadsheetProps, SpreadsheetSelection } from "../props";
import { calculateWorkbook, cellAddress, normalizeWorkbook, setCellValue, setCellValues, workbooksEqual } from "../model";
import { mergedCellPosition, rangesIntersect } from "../model/merges";
import { createSelection, isCellSelected, isRangeSelected, rangeBounds, selectedAddresses, selectionForSheet, selectionRanges, toggleRangeSelection } from "./selection";

export { MAX_SELECTION_CELLS, MAX_SELECTION_RANGES, selectedAddresses, selectionBounds, selectionRanges, rangeBounds,
  isCellSelected, isRangeSelected, isMultiRangeSelection, selectionCellCount } from "./selection";

export type Workbook = NonNullable<SpreadsheetProps["initialWorkbook"]>;
export type Sheet = Workbook["sheets"][number];
export type Position = SpreadsheetSelection["focus"];
export type CellFormat = NonNullable<Sheet["cells"][string]["format"]>;
export const ROW_HEIGHT = 28;
export const COLUMN_WIDTH = 100;

function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  const failed = (cause: unknown) => console.error("[LikeX Spreadsheet] Notification callback failed", cause);
  try { void Promise.resolve(callback?.(value)).catch(failed); } catch (cause) { failed(cause); }
}

function clampSelection(selection: SpreadsheetSelection, workbook: Workbook): SpreadsheetSelection {
  const sheet = workbook.sheets.find(item => item.id === selection.sheetId) ?? workbook.sheets[0];
  if (sheet.id !== selection.sheetId) return selectionForSheet(sheet, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]);
  const clamp = (position: Position) => clampPosition(position, sheet);
  const previous = selectionRanges(selection);
  let next = selectionForSheet(sheet, previous.map(range => ({ anchor: clamp(range.anchor), focus: clamp(range.focus) })), false);
  for (const merge of sheet.merges ?? []) {
    const range = { anchor: { row: merge.top, column: merge.left }, focus: { row: merge.bottom, column: merge.right } };
    if (selectionRanges(next).some(selected => rangesIntersect(rangeBounds(selected), merge)) && !isRangeSelected(next, range)) {
      next = selectionForSheet(sheet, [...selectionRanges(next), range], false);
    }
  }
  const focus = mergedCellPosition(sheet, clamp(selection.focus));
  if (isCellSelected(next, focus)) next = createSelection(sheet.id, selectionRanges(next), focus);
  if (selection.ranges && selectionRanges(next).length === previous.length && next.focus.row === selection.focus.row && next.focus.column === selection.focus.column &&
    selectionRanges(next).every((range, index) => range.anchor.row === previous[index].anchor.row &&
      range.anchor.column === previous[index].anchor.column && range.focus.row === previous[index].focus.row && range.focus.column === previous[index].focus.column)) return selection;
  return next;
}

function clampPosition(position: Position, sheet: Sheet): Position {
  const index = (value: number, limit: number) => Math.max(0, Math.min(limit - 1, Number.isFinite(value) ? Math.trunc(value) : 0));
  return { row: index(position.row, sheet.rowCount), column: index(position.column, sheet.columnCount) };
}

export function useSpreadsheet(props: SpreadsheetProps) {
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(props.initialWorkbook));
  const workbookRef = useRef(workbook);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const [saved, setSaved] = useState(workbook);
  const [selection, setSelectionState] = useState<SpreadsheetSelection>(() => selectionForSheet(workbook.sheets[0],
    [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]));
  const selectionRef = useRef(selection);
  const setSelection = useCallback((update: SpreadsheetSelection | ((previous: SpreadsheetSelection) => SpreadsheetSelection)) => {
    const next = typeof update === "function" ? update(selectionRef.current) : update;
    selectionRef.current = next;
    setSelectionState(next);
  }, []);
  const [gridFocusRequest, setGridFocusRequest] = useState(0);
  const [drawingSelection, setDrawingSelection] = useState<{ sheetId: string; id: string } | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [pendingObjectEdit, setPendingObjectEditState] = useState(false);
  const pendingObjectEditRef = useRef(false);
  const pendingEditOwners = useRef(new Set<object>());
  const defaultEditOwner = useRef({});
  const setPendingObjectEdit = useCallback((value: boolean, owner = defaultEditOwner.current) => {
    if (value) pendingEditOwners.current.add(owner);
    else pendingEditOwners.current.delete(owner);
    const pending = pendingEditOwners.current.size > 0;
    pendingObjectEditRef.current = pending;
    setPendingObjectEditState(pending);
  }, []);
  const [editing, setEditing] = useState<{ position: Position; value: string } | null>(null);
  const editingRef = useRef(editing);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const readOnly = props.readOnly === true || !props.onSave;
  const disabled = readOnly || saving;
  const features = { formulas: props.features?.formulas !== false, clipboard: props.features?.clipboard !== false,
    formatting: props.features?.formatting !== false, mergeCells: props.features?.mergeCells !== false, rowColumnOperations: props.features?.rowColumnOperations !== false,
    sheets: props.features?.sheets !== false, resize: props.features?.resize !== false, undoRedo: props.features?.undoRedo !== false,
    images: props.features?.images !== false, shapes: props.features?.shapes !== false,
    textBoxes: props.features?.textBoxes !== false, comments: props.features?.comments !== false };
  const activeSheet = workbook.sheets.find(sheet => sheet.id === selection.sheetId) ?? workbook.sheets[0];
  const selectedDrawing = drawingSelection?.sheetId === activeSheet.id
    ? activeSheet.drawings?.find(drawing => drawing.id === drawingSelection.id &&
      (drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes))
    : undefined;
  const selectedDrawingId = selectedDrawing?.id ?? null;
  const calculated = useMemo(() => calculateWorkbook(workbook), [workbook]);
  const dirty = useMemo(() => !workbooksEqual(workbook, saved), [workbook, saved]);
  const reportError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : "操作に失敗しました"), []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => notify(propsRef.current.onSelectionChange, createSelection(selection.sheetId, selectionRanges(selection), selection.focus)), [selection]);

  const apply = useCallback((operation: (current: Workbook) => Workbook): boolean => {
    if (!mounted.current || propsRef.current.readOnly || !propsRef.current.onSave || savingRef.current) return false;
    try {
      const before = workbookRef.current;
      const next = operation(before);
      if (next === before) return true;
      const nextSelection = clampSelection(selectionRef.current, next);
      if (propsRef.current.features?.undoRedo !== false) {
        history.current.past = [...history.current.past.slice(-49), before];
        history.current.future = [];
      } else history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: false });
      workbookRef.current = next;
      setWorkbook(next);
      setSelection(nextSelection);
      setError(null);
      notify(propsRef.current.onChange, next);
      return true;
    } catch (cause) { reportError(cause); return false; }
  }, [reportError, setSelection]);

  const writeValues = (values: Record<string, string>) => apply(current => {
    if (!features.formulas && Object.values(values).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
    return setCellValues(current, activeSheet.id, values);
  });
  const beginEdit = (position = selection.focus, value?: string) => {
    if (disabled) return;
    setDrawingSelection(null);
    const anchor = mergedCellPosition(activeSheet, clampPosition(position, activeSheet));
    const next = { position: anchor, value: value ?? activeSheet.cells[cellAddress(anchor.row, anchor.column)]?.value ?? "" };
    editingRef.current = next;
    setEditing(next);
  };
  const cancelEdit = () => { editingRef.current = null; setEditing(null); };
  const commitEdit = () => {
    const current = editingRef.current;
    if (!current) return true;
    const accepted = apply(wb => {
      if (!features.formulas && current.value.startsWith("=")) throw new Error("数式の入力は無効です");
      return setCellValue(wb, activeSheet.id, cellAddress(current.position.row, current.position.column), current.value);
    });
    if (accepted) cancelEdit();
    return accepted;
  };
  const select = (position: Position, extend = false, additive = false): boolean => {
    const next = clampPosition(position, activeSheet);
    try { setSelection(old => {
      const previous = selectionRanges(old);
      const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: extend ? old.anchor : next, focus: next }]))[0];
      return selectionForSheet(activeSheet, extend ? [...previous.slice(0, -1), range] : additive ? [...previous, range] : [range], false, next);
    }); setDrawingSelection(null); return true; } catch (cause) { reportError(cause); return false; }
  };
  const selectRange = (anchor: Position, focus: Position, additive = false, extend = false): boolean => {
    const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: clampPosition(anchor, activeSheet), focus: clampPosition(focus, activeSheet) }]))[0];
    try { setSelection(old => selectionForSheet(activeSheet,
      extend ? [...selectionRanges(old).slice(0, -1), range] : additive ? [...selectionRanges(old), range] : [range], false, clampPosition(focus, activeSheet))); setDrawingSelection(null); return true; }
    catch (cause) { reportError(cause); return false; }
  };
  const toggleSelectionRange = (anchor: Position, focus: Position): boolean => {
    const range = selectionRanges(selectionForSheet(activeSheet, [{ anchor: clampPosition(anchor, activeSheet), focus: clampPosition(focus, activeSheet) }]))[0];
    try { setSelection(old => {
      const toggled = selectionRanges(toggleRangeSelection(old, range));
      const singleCell = toggled.length === 1 && toggled[0].anchor.row === toggled[0].focus.row && toggled[0].anchor.column === toggled[0].focus.column;
      return selectionForSheet(activeSheet, toggled, singleCell);
    }); setDrawingSelection(null); return true; }
    catch (cause) { reportError(cause); return false; }
  };
  const toggleSelection = (position: Position) => toggleSelectionRange(position, position);
  const selectDrawing = (id: string | null) => {
    if (!commitEdit()) return false;
    setDrawingSelection(id ? { sheetId: activeSheet.id, id } : null);
    if (id) setCommentOpen(false);
    return true;
  };
  const switchSheet = (id: string) => {
    if (!commitEdit()) return;
    setDrawingSelection(null);
    setCommentOpen(false);
    const sheet = workbookRef.current.sheets.find(item => item.id === id);
    if (!sheet) return;
    setSelection(selectionForSheet(sheet, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]));
  };
  const changeHistory = (direction: "past" | "future") => {
    if (disabled || !features.undoRedo) return;
    const list = history.current[direction];
    const next = list.at(-1);
    if (!next) return;
    const opposite = direction === "past" ? "future" : "past";
    history.current[opposite] = [...history.current[opposite].slice(-49), workbookRef.current];
    history.current[direction] = list.slice(0, -1);
    setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 });
    workbookRef.current = next;
    setWorkbook(next);
    cancelEdit();
    setDrawingSelection(null);
    setError(null);
    const sheet = next.sheets.find(item => item.id === selection.sheetId) ?? next.sheets[0];
    setSelection(selectionForSheet(sheet, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]));
    notify(propsRef.current.onChange, next);
  };
  const save = async () => {
    if (propsRef.current.readOnly || !propsRef.current.onSave || savingRef.current || !commitEdit()) return;
    if (pendingObjectEditRef.current) { reportError(new Error("編集中の内容を確定してください")); return; }
    const snapshot = workbookRef.current;
    if (workbooksEqual(snapshot, saved)) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await propsRef.current.onSave(snapshot);
      const accepted = normalizeWorkbook(response ?? snapshot);
      if (!mounted.current) return;
      workbookRef.current = accepted;
      setWorkbook(accepted);
      setSaved(accepted);
      setDrawingSelection(null);
      history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: false, canRedo: false });
      const sheet = accepted.sheets.find(item => item.id === selection.sheetId) ?? accepted.sheets[0];
      setSelection(selectionForSheet(sheet, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]));
    } catch (cause) { if (mounted.current) reportError(cause); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const clearCells = () => {
    try { writeValues(Object.fromEntries(selectedAddresses(selection).map(address => [address, ""]))); }
    catch (cause) { reportError(cause); }
  };

  return { workbook, activeSheet, selection, select, selectRange, toggleSelection, toggleSelectionRange, switchSheet, calculated, editing, beginEdit, cancelEdit, commitEdit,
    selectedDrawingId, selectedDrawing, selectDrawing, commentOpen: features.comments && commentOpen, setCommentOpen,
    pendingObjectEdit, setPendingObjectEdit,
    gridFocusRequest, requestGridFocus: () => setGridFocusRequest(value => value + 1),
    features, readOnly, disabled, dirty, saving, error, setError, reportError, apply, writeValues, clearCells, save,
    undo: () => changeHistory("past"), redo: () => changeHistory("future"), ...historyStatus };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
