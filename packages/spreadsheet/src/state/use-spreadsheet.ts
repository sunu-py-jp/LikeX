"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SpreadsheetProps, SpreadsheetSelection } from "../props";
import { calculateWorkbook, cellAddress, normalizeWorkbook, setCellValue, setCellValues, SPREADSHEET_LIMITS, workbooksEqual } from "../model";

export type Workbook = NonNullable<SpreadsheetProps["initialWorkbook"]>;
export type Sheet = Workbook["sheets"][number];
export type Position = SpreadsheetSelection["focus"];
export type CellFormat = NonNullable<Sheet["cells"][string]["format"]>;
export const MAX_SELECTION_CELLS = SPREADSHEET_LIMITS.clipboardCells;
export const ROW_HEIGHT = 28;
export const COLUMN_WIDTH = 100;

export function selectionBounds(selection: SpreadsheetSelection) {
  return { top: Math.min(selection.anchor.row, selection.focus.row), bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.column, selection.focus.column), right: Math.max(selection.anchor.column, selection.focus.column) };
}

export function selectedAddresses(selection: SpreadsheetSelection) {
  const { top, bottom, left, right } = selectionBounds(selection);
  if ((bottom - top + 1) * (right - left + 1) > MAX_SELECTION_CELLS)
    throw new Error(`一度に操作できる範囲は ${MAX_SELECTION_CELLS.toLocaleString()} セルまでです`);
  const addresses: string[] = [];
  for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) addresses.push(cellAddress(row, column));
  return addresses;
}

function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  const failed = (cause: unknown) => console.error("[LikeX Spreadsheet] Notification callback failed", cause);
  try { void Promise.resolve(callback?.(value)).catch(failed); } catch (cause) { failed(cause); }
}

function clampSelection(selection: SpreadsheetSelection, workbook: Workbook): SpreadsheetSelection {
  const sheet = workbook.sheets.find(item => item.id === selection.sheetId) ?? workbook.sheets[0];
  const clamp = (position: Position) => ({ row: Math.max(0, Math.min(sheet.rowCount - 1, position.row)), column: Math.max(0, Math.min(sheet.columnCount - 1, position.column)) });
  const anchor = clamp(selection.anchor), focus = clamp(selection.focus);
  if (sheet.id === selection.sheetId && anchor.row === selection.anchor.row && anchor.column === selection.anchor.column && focus.row === selection.focus.row && focus.column === selection.focus.column) return selection;
  return { sheetId: sheet.id, anchor, focus };
}

export function useSpreadsheet(props: SpreadsheetProps) {
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(props.initialWorkbook));
  const workbookRef = useRef(workbook);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const [saved, setSaved] = useState(workbook);
  const [selection, setSelection] = useState<SpreadsheetSelection>(() => ({ sheetId: workbook.sheets[0].id, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }));
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
    formatting: props.features?.formatting !== false, rowColumnOperations: props.features?.rowColumnOperations !== false,
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
  useEffect(() => notify(propsRef.current.onSelectionChange, {
    ...selection, anchor: { ...selection.anchor }, focus: { ...selection.focus },
  }), [selection]);

  const apply = useCallback((operation: (current: Workbook) => Workbook): boolean => {
    if (!mounted.current || propsRef.current.readOnly || !propsRef.current.onSave || savingRef.current) return false;
    try {
      const before = workbookRef.current;
      const next = operation(before);
      if (next === before) return true;
      if (propsRef.current.features?.undoRedo !== false) {
        history.current.past = [...history.current.past.slice(-49), before];
        history.current.future = [];
      } else history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: false });
      workbookRef.current = next;
      setWorkbook(next);
      setSelection(old => clampSelection(old, next));
      setError(null);
      notify(propsRef.current.onChange, next);
      return true;
    } catch (cause) { reportError(cause); return false; }
  }, [reportError]);

  const writeValues = (values: Record<string, string>) => apply(current => {
    if (!features.formulas && Object.values(values).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
    return setCellValues(current, activeSheet.id, values);
  });
  const beginEdit = (position = selection.focus, value = activeSheet.cells[cellAddress(position.row, position.column)]?.value ?? "") => {
    if (disabled) return;
    setDrawingSelection(null);
    const next = { position, value };
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
  const select = (position: Position, extend = false) => {
    setDrawingSelection(null);
    const next = { row: Math.max(0, Math.min(activeSheet.rowCount - 1, position.row)), column: Math.max(0, Math.min(activeSheet.columnCount - 1, position.column)) };
    setSelection(old => ({ sheetId: activeSheet.id, anchor: extend ? old.anchor : next, focus: next }));
  };
  const selectRange = (anchor: Position, focus: Position) => {
    setDrawingSelection(null);
    setSelection({ sheetId: activeSheet.id, anchor, focus });
  };
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
    setSelection({ sheetId: id, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
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
    setSelection({ sheetId: sheet.id, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
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
      setSelection({ sheetId: sheet.id, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
    } catch (cause) { if (mounted.current) reportError(cause); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const clearCells = () => {
    try { writeValues(Object.fromEntries(selectedAddresses(selection).map(address => [address, ""]))); }
    catch (cause) { reportError(cause); }
  };

  return { workbook, activeSheet, selection, select, selectRange, switchSheet, calculated, editing, beginEdit, cancelEdit, commitEdit,
    selectedDrawingId, selectedDrawing, selectDrawing, commentOpen: features.comments && commentOpen, setCommentOpen,
    pendingObjectEdit, setPendingObjectEdit,
    gridFocusRequest, requestGridFocus: () => setGridFocusRequest(value => value + 1),
    features, readOnly, disabled, dirty, saving, error, setError, reportError, apply, writeValues, clearCells, save,
    undo: () => changeHistory("past"), redo: () => changeHistory("future"), ...historyStatus };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
