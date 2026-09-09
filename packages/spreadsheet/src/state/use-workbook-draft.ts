"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeWorkbook, workbooksEqual } from "../model";
import type { SpreadsheetCommandFailure } from "../api/types";
import type { SpreadsheetProps } from "../props";
import { notifySpreadsheetHost } from "./notifications";
import { clampSelection } from "./selection";
import type { DraftSelection, Workbook, WorkbookOperation } from "./types";

type HistoryDirection = "past" | "future";
type SaveSession = {
  commitEdit: () => boolean;
  hasPendingEdits: () => boolean;
  resetView: (workbook: Workbook) => void;
};
type DraftCommitResult = { ok: true; changed: boolean } | SpreadsheetCommandFailure;

/** Owns immutable draft snapshots, bounded history, host persistence, and their synchronous guards. */
export function useWorkbookDraft(props: SpreadsheetProps) {
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(props.initialWorkbook));
  const workbookRef = useRef(workbook);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const [saved, setSaved] = useState(workbook);
  const savedRef = useRef(saved);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const transactionRef = useRef(false);
  const saveStartingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : "操作に失敗しました"), []);
  const history = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const readOnly = props.readOnly === true || !props.onSave;
  const disabled = readOnly || saving;
  const dirty = useMemo(() => !workbooksEqual(workbook, saved), [workbook, saved]);

  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const getMutationFailure = useCallback((allowSaveStarting = false): SpreadsheetCommandFailure | null => {
    if (!mounted.current) return { ok: false, code: "NOT_MOUNTED", message: "スプレッドシートは表示されていません" };
    if (propsRef.current.readOnly || !propsRef.current.onSave) return { ok: false, code: "READ_ONLY", message: "読み取り専用のため変更できません" };
    if (savingRef.current) return { ok: false, code: "SAVING", message: "保存中のため変更できません" };
    if (transactionRef.current || (!allowSaveStarting && saveStartingRef.current)) return { ok: false, code: "BUSY", message: "ほかの操作を処理しています" };
    return null;
  }, []);

  const applyTransaction = useCallback((operation: WorkbookOperation, selection: DraftSelection, allowSaveStarting = false): DraftCommitResult => {
    const failure = getMutationFailure(allowSaveStarting);
    if (failure) return failure;
    transactionRef.current = true;
    try {
      const before = workbookRef.current;
      const next = operation(before);
      if (next === before) return { ok: true, changed: false };
      // Selection normalization may reject a structural change. Nothing has been published yet.
      const nextSelection = clampSelection(selection.selectionRef.current, next);
      if (propsRef.current.features?.undoRedo !== false) {
        history.current.past = [...history.current.past.slice(-49), before];
        history.current.future = [];
      } else history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: false });
      workbookRef.current = next;
      setWorkbook(next);
      selection.setSelection(nextSelection);
      setError(null);
      notifySpreadsheetHost(propsRef.current.onChange, next);
      return { ok: true, changed: true };
    } catch (cause) { return { ok: false, code: "VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "操作に失敗しました" }; }
    finally { transactionRef.current = false; }
  }, [getMutationFailure]);

  const apply = useCallback((operation: WorkbookOperation, selection: DraftSelection): boolean => {
    // The save workflow is allowed to commit its own cell editor before entering the saving phase.
    const result = applyTransaction(operation, selection, true);
    if (!result.ok && result.code === "VALIDATION_FAILED") reportError(new Error(result.message));
    return result.ok;
  }, [applyTransaction, reportError]);

  const changeHistory = (direction: HistoryDirection, resetView: (workbook: Workbook) => void) => {
    if (getMutationFailure() || propsRef.current.features?.undoRedo === false) return;
    const next = history.current[direction].at(-1);
    if (!next) return;
    transactionRef.current = true;
    try {
      const opposite = direction === "past" ? "future" : "past";
      history.current[opposite] = [...history.current[opposite].slice(-49), workbookRef.current];
      history.current[direction] = history.current[direction].slice(0, -1);
      setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 });
      workbookRef.current = next;
      setWorkbook(next);
      setError(null);
      resetView(next);
      notifySpreadsheetHost(propsRef.current.onChange, next);
    } finally { transactionRef.current = false; }
  };

  const save = async (session: SaveSession) => {
    if (getMutationFailure()) return;
    saveStartingRef.current = true;
    let snapshot: Workbook;
    try {
      if (!session.commitEdit() || getMutationFailure(true)) return;
      if (session.hasPendingEdits()) { reportError(new Error("編集中の内容を確定してください")); return; }
      snapshot = workbookRef.current;
      if (workbooksEqual(snapshot, savedRef.current)) return;
      savingRef.current = true;
      setSaving(true);
      setError(null);
    } finally { saveStartingRef.current = false; }
    try {
      const response = await propsRef.current.onSave!(snapshot);
      const accepted = normalizeWorkbook(response ?? snapshot);
      if (!mounted.current) return;
      workbookRef.current = accepted;
      setWorkbook(accepted);
      savedRef.current = accepted;
      setSaved(accepted);
      history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: false, canRedo: false });
      session.resetView(accepted);
    } catch (cause) { if (mounted.current) reportError(cause); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  return { workbook, workbookRef, propsRef, readOnly, disabled, dirty, saving, error, setError, reportError,
    apply, applyTransaction, getMutationFailure, changeHistory, save, ...historyStatus };
}
