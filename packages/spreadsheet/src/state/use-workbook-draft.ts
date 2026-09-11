"use client";

import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeWorkbook, workbooksEqual } from "../model";
import { notifyHost, type MaybePromise } from "../core";
import type { SpreadsheetCommandFailure } from "../api/types";
import type { SpreadsheetChangeSource, SpreadsheetEditIntent, SpreadsheetEvent } from "../api/lifecycle";
import { createWorkbookHistory, type WorkbookHistoryDirection } from "../history/workbook-history";
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
  /** Private capability used only when publishing a prepared context-menu result. */
  mutationOwner?: object;
};
export type DraftHistoryOptions = {
  source?: "ui" | "api";
  /** Recheck a caller's pending-editor guard after asynchronous permission. */
  isCurrent?: () => boolean;
};

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
  const contextMenuOwnerRef = useRef<object | null>(null);
  const [contextMenuLocked, setContextMenuLocked] = useState(false);
  const revisionRef = useRef(0);
  const structureRevisionRef = useRef(0);
  const setContextMenuLock = useCallback((owner: object | null) => {
    contextMenuOwnerRef.current = owner;
    setContextMenuLocked(owner !== null);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((cause: unknown) => {
    if (lifetimeRef.current) setError(cause instanceof Error ? cause.message : "操作に失敗しました");
  }, []);
  const [history] = useState(() => createWorkbookHistory());
  const [historyStatus, setHistoryStatus] = useState(history.getState);
  const resetViewRef = useRef<((next: Workbook) => void) | null>(null);
  const readOnly = props.readOnly === true || !props.onSave;
  const dirty = useMemo(() => !workbooksEqual(workbook, saved), [workbook, saved]);
  useLayoutEffect(() => {
    lifetimeRef.current = {};
    return () => { lifetimeRef.current = null; saveStartingRef.current = false; };
  }, []);
  const emitEvent = useCallback((event: SpreadsheetEvent) => notifyHost(propsRef.current.onEvent, event), []);
  useEffect(() => { notifyHost(props.onDirtyChange, dirty); }, [props.onDirtyChange, dirty]);
  const getMutationFailure = useCallback((allowSaveStarting = false, mutationOwner?: object): SpreadsheetCommandFailure | null => {
    if (!lifetimeRef.current) return { ok: false, code: "NOT_MOUNTED", message: "スプレッドシートは表示されていません" };
    if (propsRef.current.readOnly || !propsRef.current.onSave) return { ok: false, code: "READ_ONLY", message: "読み取り専用のため変更できません" };
    if (savingRef.current) return { ok: false, code: "SAVING", message: "保存中のため変更できません" };
    if (refreshingRef.current) return { ok: false, code: "REFRESHING", message: "再読み込み中のため変更できません" };
    if (contextMenuOwnerRef.current && contextMenuOwnerRef.current !== mutationOwner) return { ok: false, code: "BUSY", message: "右クリックメニューの処理が完了するまで変更できません" };
    if (transactionRef.current || (!allowSaveStarting && saveStartingRef.current)) return { ok: false, code: "BUSY", message: "ほかの操作を処理しています" };
    return null;
  }, []);
  const clearHistory = useCallback(() => {
    history.clear();
    setHistoryStatus(history.getState());
  }, [history]);
  const replaceBaseline = useCallback((next: Workbook) => {
    revisionRef.current++;
    structureRevisionRef.current++;
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
  const editUnavailable = useCallback((owner?: object) => getMutationFailure(true, owner), [getMutationFailure]);
  const edit = useSpreadsheetEditSession({ propsRef, workbookRef, unavailable: editUnavailable,
    acceptBaseline: acceptEditBaseline, emitEvent, readOnly });

  const publishChange = useCallback((next: Workbook, source: SpreadsheetChangeSource, commands?: SpreadsheetEditIntent["commands"]) => {
    const before = workbookRef.current;
    revisionRef.current++;
    if (source === "undo" || source === "redo" || commands?.some(command => /^(rows\.|columns\.(insert|delete)|sheets\.(add|delete)|cells\.(merge|unmerge))/.test(command)) ||
      before.sheets.length !== next.sheets.length || before.sheets.some((sheet, index) => {
        const current = next.sheets[index];
        return !current || current.id !== sheet.id || current.rowCount !== sheet.rowCount || current.columnCount !== sheet.columnCount || current.merges !== sheet.merges;
      })) structureRevisionRef.current++;
    workbookRef.current = next;
    setWorkbook(next);
    setError(null);
    notifyHost(propsRef.current.onChange, next);
    emitEvent({ type: "change", source, workbook: next, ...(commands ? { commands: [...commands] } : {}) });
  }, [emitEvent]);
  const applyTransaction = useCallback((operation: WorkbookOperation, selection: DraftSelection,
    options: DraftOperationOptions = {}): MaybePromise<DraftCommitResult> => {
    const unavailable = getMutationFailure(options.allowSaveStarting, options.mutationOwner);
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
    const permission = edit.requestEdit(options, options.mutationOwner);
    const requestedId = edit.getEditState().requestId;
    const commit = (allowed: boolean): DraftCommitResult => {
      const failure = getMutationFailure(options.allowSaveStarting, options.mutationOwner);
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
        history.record(before, propsRef.current.features?.undoRedo !== false);
        setHistoryStatus(history.getState());
        selection.setSelection(nextSelection);
        publishChange(next, options.source ?? "ui", options.commands);
        return { ok: true, changed: true };
      } catch (cause) { return { ok: false, code: "VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "操作に失敗しました" }; }
      finally { transactionRef.current = false; }
    };
    return typeof permission === "boolean" ? commit(permission) : permission.then(commit);
  }, [getMutationFailure, edit, publishChange, history]);
  const changeHistory = (direction: WorkbookHistoryDirection, resetView: (workbook: Workbook, previous: Workbook) => void,
    options: DraftHistoryOptions = {}): MaybePromise<boolean> => {
    if (getMutationFailure() || propsRef.current.features?.undoRedo === false || (options.isCurrent && !options.isCurrent())) return false;
    const next = history.peek(direction);
    if (!next) return false;
    const before = workbookRef.current;
    const permission = edit.requestEdit({ action: direction === "past" ? "undo" : "redo", source: options.source ?? "ui" });
    const requestedId = edit.getEditState().requestId;
    const finish = (allowed: boolean) => {
      if (!allowed || getMutationFailure() || edit.getEditState().requestId !== requestedId ||
        propsRef.current.features?.undoRedo === false || workbookRef.current !== before || history.peek(direction) !== next ||
        (options.isCurrent && !options.isCurrent())) return false;
      transactionRef.current = true;
      try {
        history.step(direction, before);
        setHistoryStatus(history.getState());
        resetView(next, before);
        publishChange(next, direction === "past" ? "undo" : "redo");
        return true;
      } finally { transactionRef.current = false; }
    };
    return typeof permission === "boolean" ? finish(permission) : permission.then(finish);
  };
  const persistence = useWorkbookPersistence({ workbookRef, savedRef, propsRef, lifetimeRef, savingRef, refreshingRef,
    saveStartingRef, transactionRef, contextMenuOwnerRef, getMutationFailure, replaceBaseline, reportError, emitEvent, edit });
  const endEdit = useCallback(() => {
    if (getMutationFailure() || !workbooksEqual(workbookRef.current, savedRef.current)) return false;
    return edit.finishEdit("ended");
  }, [edit, getMutationFailure]);

  return { workbook, workbookRef, propsRef, readOnly, disabled: readOnly || persistence.saving || persistence.refreshing || contextMenuLocked,
    isOperationPending: () => !!(savingRef.current || refreshingRef.current || saveStartingRef.current || transactionRef.current ||
      contextMenuOwnerRef.current || edit.getEditState().mode === "requesting" || edit.isEndingEdit()),
    setContextMenuLock, contextMenuLocked, revisionRef, structureRevisionRef,
    dirty, error, setError, reportError, applyTransaction, getMutationFailure, changeHistory,
    getHistoryState: history.getState, ...historyStatus,
    ...persistence, ...edit, endEdit, emitEvent, resetViewRef };
}
