"use client";

import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeWorkbook, workbooksEqual } from "../model";
import { notifyHost, type MaybePromise } from "../core";
import type { SpreadsheetCommandFailure } from "../api/types";
import type { SpreadsheetChangeSource, SpreadsheetEditIntent, SpreadsheetEvent } from "../api/lifecycle";
import type { SpreadsheetProps } from "../props";
import { clampSelection } from "./selection";
import type { DraftSelection, Workbook, WorkbookOperation } from "./types";
import { useSpreadsheetEditSession } from "./use-spreadsheet-edit-session";
import { useWorkbookPersistence } from "./use-workbook-persistence";

export type DraftCommitResult = { ok: true; changed: boolean } | SpreadsheetCommandFailure;
export type DraftOperationOptions = SpreadsheetEditIntent & {
  synchronous?: boolean;
  allowSaveStarting?: boolean;
  /** A captured editor or async action may have been cancelled while permission was pending. */
  isCurrent?: () => boolean;
};
type HistoryDirection = "past" | "future";

/** Immutable snapshots, bounded history, and the single publication boundary for every mutation. */
export function useWorkbookDraft(props: SpreadsheetProps) {
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(props.initialWorkbook));
  const workbookRef = useRef(workbook);
  const propsRef = useRef(props);
  useInsertionEffect(() => { propsRef.current = props; });
  const [saved, setSaved] = useState(workbook);
  const savedRef = useRef(saved);
  const lifetimeRef = useRef<object | null>(null);
  const transactionRef = useRef(false);
  const saveStartingRef = useRef(false);
  const savingRef = useRef(false);
  const refreshingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((cause: unknown) => {
    if (lifetimeRef.current) setError(cause instanceof Error ? cause.message : "操作に失敗しました");
  }, []);
  const history = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const resetViewRef = useRef<((next: Workbook) => void) | null>(null);
  const readOnly = props.readOnly === true || !props.onSave;
  const dirty = useMemo(() => !workbooksEqual(workbook, saved), [workbook, saved]);
  useLayoutEffect(() => {
    lifetimeRef.current = {};
    return () => { lifetimeRef.current = null; saveStartingRef.current = false; };
  }, []);
  const emitEvent = useCallback((event: SpreadsheetEvent) => notifyHost(propsRef.current.onEvent, event), []);
  useEffect(() => { notifyHost(props.onDirtyChange, dirty); }, [props.onDirtyChange, dirty]);
  const getMutationFailure = useCallback((allowSaveStarting = false): SpreadsheetCommandFailure | null => {
    if (!lifetimeRef.current) return { ok: false, code: "NOT_MOUNTED", message: "スプレッドシートは表示されていません" };
    if (propsRef.current.readOnly || !propsRef.current.onSave) return { ok: false, code: "READ_ONLY", message: "読み取り専用のため変更できません" };
    if (savingRef.current) return { ok: false, code: "SAVING", message: "保存中のため変更できません" };
    if (refreshingRef.current) return { ok: false, code: "REFRESHING", message: "再読み込み中のため変更できません" };
    if (transactionRef.current || (!allowSaveStarting && saveStartingRef.current)) return { ok: false, code: "BUSY", message: "ほかの操作を処理しています" };
    return null;
  }, []);
  const clearHistory = useCallback(() => {
    history.current = { past: [], future: [] };
    setHistoryStatus({ canUndo: false, canRedo: false });
  }, []);
  const replaceBaseline = useCallback((next: Workbook) => {
    workbookRef.current = next;
    savedRef.current = next;
    setWorkbook(next);
    setSaved(next);
    clearHistory();
    setError(null);
    resetViewRef.current?.(next);
  }, [clearHistory]);
  const acceptEditBaseline = useCallback((next: Workbook) => {
    if (!workbooksEqual(workbookRef.current, savedRef.current)) throw new Error("未保存の変更があるため、最新のデータへ置き換えられません");
    const accepted = normalizeWorkbook(next);
    if (!workbooksEqual(accepted, workbookRef.current)) replaceBaseline(accepted);
  }, [replaceBaseline]);
  const editUnavailable = useCallback(() => getMutationFailure(true), [getMutationFailure]);
  const edit = useSpreadsheetEditSession({ propsRef, workbookRef, unavailable: editUnavailable,
    acceptBaseline: acceptEditBaseline, emitEvent, readOnly });

  const publishChange = useCallback((next: Workbook, source: SpreadsheetChangeSource, commands?: SpreadsheetEditIntent["commands"]) => {
    workbookRef.current = next;
    setWorkbook(next);
    setError(null);
    notifyHost(propsRef.current.onChange, next);
    emitEvent({ type: "change", source, workbook: next, ...(commands ? { commands: [...commands] } : {}) });
  }, [emitEvent]);
  const applyTransaction = useCallback((operation: WorkbookOperation, selection: DraftSelection,
    options: DraftOperationOptions = {}): MaybePromise<DraftCommitResult> => {
    const unavailable = getMutationFailure(options.allowSaveStarting);
    if (unavailable) return unavailable;
    if (edit.isEndingEdit()) return { ok: false, code: "BUSY", message: "編集セッションを終了しています" };
    if (edit.getEditState().mode === "requesting") return { ok: false, code: "EDIT_PENDING", message: "編集の許可を確認しています" };
    const source = workbookRef.current;
    try {
      transactionRef.current = true;
      const candidate = operation(source);
      if (candidate === source || workbooksEqual(source, candidate)) return { ok: true, changed: false };
      clampSelection(selection.selectionRef.current, candidate);
    } catch (cause) { return { ok: false, code: "VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "操作に失敗しました" }; }
    finally { transactionRef.current = false; }
    if (options.synchronous && propsRef.current.onEditRequest && edit.getEditState().mode !== "edit")
      return { ok: false, code: "EDIT_REQUIRED", message: "executeAsync または requestEdit で編集の許可を取得してください" };
    const permission = edit.requestEdit(options);
    const requestedId = edit.getEditState().requestId;
    const commit = (allowed: boolean): DraftCommitResult => {
      const failure = getMutationFailure(options.allowSaveStarting);
      if (failure) return failure;
      const currentEdit = edit.getEditState();
      if (!allowed || !requestedId || currentEdit.mode !== "edit" || currentEdit.requestId !== requestedId)
        return { ok: false, code: currentEdit.error ? "EDIT_DENIED" : "EDIT_CANCELLED", message: currentEdit.error ?? "編集の要求がキャンセルされました" };
      if (options.isCurrent && !options.isCurrent()) return { ok: false, code: "EDIT_CANCELLED", message: "操作がキャンセルされました" };
      if ((options.source ?? "ui") === "ui" && source !== workbookRef.current)
        return { ok: false, code: "STALE_TARGET", message: "最新のデータを読み込みました。対象を確認して操作し直してください" };
      transactionRef.current = true;
      try {
        const before = workbookRef.current;
        const next = operation(before);
        if (next === before || workbooksEqual(next, before)) return { ok: true, changed: false };
        const nextSelection = clampSelection(selection.selectionRef.current, next);
        if (propsRef.current.features?.undoRedo !== false) {
          history.current.past = [...history.current.past.slice(-49), before];
          history.current.future = [];
        } else history.current = { past: [], future: [] };
        setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: false });
        selection.setSelection(nextSelection);
        publishChange(next, options.source ?? "ui", options.commands);
        return { ok: true, changed: true };
      } catch (cause) { return { ok: false, code: "VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "操作に失敗しました" }; }
      finally { transactionRef.current = false; }
    };
    return typeof permission === "boolean" ? commit(permission) : permission.then(commit);
  }, [getMutationFailure, edit, publishChange]);
  const apply = useCallback((operation: WorkbookOperation, selection: DraftSelection,
    options: DraftOperationOptions = {}): MaybePromise<boolean> => {
    const result = applyTransaction(operation, selection, { ...options, allowSaveStarting: true });
    const finish = (value: DraftCommitResult) => {
      if (!value.ok && value.code !== "NOT_MOUNTED" && value.code !== "EDIT_CANCELLED") reportError(new Error(value.message));
      return value.ok;
    };
    return result instanceof Promise ? result.then(finish) : finish(result);
  }, [applyTransaction, reportError]);
  const changeHistory = (direction: HistoryDirection, resetView: (workbook: Workbook) => void): MaybePromise<boolean> => {
    if (getMutationFailure() || propsRef.current.features?.undoRedo === false) return false;
    const next = history.current[direction].at(-1);
    if (!next) return false;
    const before = workbookRef.current;
    const permission = edit.requestEdit({ action: direction === "past" ? "undo" : "redo", source: "ui" });
    const requestedId = edit.getEditState().requestId;
    const finish = (allowed: boolean) => {
      if (!allowed || getMutationFailure() || edit.getEditState().requestId !== requestedId ||
        propsRef.current.features?.undoRedo === false || workbookRef.current !== before || history.current[direction].at(-1) !== next) return false;
      transactionRef.current = true;
      try {
        const opposite = direction === "past" ? "future" : "past";
        history.current[opposite] = [...history.current[opposite].slice(-49), before];
        history.current[direction] = history.current[direction].slice(0, -1);
        setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 });
        resetView(next);
        publishChange(next, direction === "past" ? "undo" : "redo");
        return true;
      } finally { transactionRef.current = false; }
    };
    return typeof permission === "boolean" ? finish(permission) : permission.then(finish);
  };
  const persistence = useWorkbookPersistence({ workbookRef, savedRef, propsRef, lifetimeRef, savingRef, refreshingRef,
    saveStartingRef, transactionRef, getMutationFailure, replaceBaseline, reportError, emitEvent, edit });
  const endEdit = useCallback(() => {
    if (getMutationFailure() || !workbooksEqual(workbookRef.current, savedRef.current)) return false;
    return edit.finishEdit("ended");
  }, [edit, getMutationFailure]);

  return { workbook, workbookRef, propsRef, readOnly, disabled: readOnly || persistence.saving || persistence.refreshing,
    dirty, error, setError, reportError, apply, applyTransaction, getMutationFailure, changeHistory, ...historyStatus,
    ...persistence, ...edit, endEdit, emitEvent, resetViewRef };
}
