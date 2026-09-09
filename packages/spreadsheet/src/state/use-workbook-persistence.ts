"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { normalizeWorkbook, workbooksEqual } from "../model";
import type { MaybePromise } from "../core";
import type { SpreadsheetDiscardOptions, SpreadsheetEvent } from "../api/lifecycle";
import type { SpreadsheetCommandFailure } from "../api/types";
import type { SpreadsheetProps } from "../props";
import type { Workbook } from "./types";
import type { useSpreadsheetEditSession } from "./use-spreadsheet-edit-session";

export type WorkbookViewSession = {
  commitEdit: () => MaybePromise<boolean>;
  hasPendingEdits: () => boolean;
  resetView: (workbook: Workbook) => void;
};
type Options = {
  workbookRef: RefObject<Workbook>; savedRef: RefObject<Workbook>; propsRef: RefObject<SpreadsheetProps>;
  lifetimeRef: RefObject<object | null>; savingRef: RefObject<boolean>; refreshingRef: RefObject<boolean>;
  saveStartingRef: RefObject<boolean>; transactionRef: RefObject<boolean>;
  contextMenuOwnerRef?: RefObject<object | null>;
  getMutationFailure: (allowSaveStarting?: boolean) => SpreadsheetCommandFailure | null;
  replaceBaseline: (workbook: Workbook) => void;
  reportError: (cause: unknown) => void;
  emitEvent: (event: SpreadsheetEvent) => void;
  edit: ReturnType<typeof useSpreadsheetEditSession>;
};
type PersistenceRequest = { id: string; controller: AbortController; lifetime: object; kind: "save" | "refresh" };

/** Save and refresh share one request token, with no continuations across a mount lifetime. */
export function useWorkbookPersistence(options: Options) {
  const { workbookRef, savedRef, propsRef, lifetimeRef, savingRef, refreshingRef, saveStartingRef, transactionRef,
    getMutationFailure, replaceBaseline, reportError, emitEvent, edit } = options;
  const active = useRef<PersistenceRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useLayoutEffect(() => {
    savingRef.current = false;
    refreshingRef.current = false;
    return () => {
      const old = active.current;
      active.current = null;
      savingRef.current = false; refreshingRef.current = false;
      // React may reuse this state when a hidden or Strict Mode tree reconnects its effects.
      setSaving(false); setRefreshing(false);
      old?.controller.abort("unmounted");
    };
  }, [savingRef, refreshingRef]);
  const current = (request: PersistenceRequest) => active.current === request && lifetimeRef.current === request.lifetime && !request.controller.signal.aborted;
  const begin = (kind: PersistenceRequest["kind"]): PersistenceRequest | null => {
    if (!lifetimeRef.current || active.current) return null;
    const request = { id: crypto.randomUUID(), controller: new AbortController(), lifetime: lifetimeRef.current, kind };
    active.current = request;
    if (kind === "save") { savingRef.current = true; setSaving(true); }
    else { refreshingRef.current = true; setRefreshing(true); }
    return request;
  };
  const finish = (request: PersistenceRequest) => {
    if (active.current !== request) return;
    active.current = null;
    savingRef.current = false; refreshingRef.current = false;
    if (lifetimeRef.current === request.lifetime) { setSaving(false); setRefreshing(false); }
    request.controller.abort("completed");
  };
  const save = async (session: WorkbookViewSession): Promise<boolean> => {
    const saveEnabled = () => propsRef.current.features?.save !== false;
    if (getMutationFailure() || !saveEnabled() || edit.getEditState().mode === "requesting") return false;
    const lifetime = lifetimeRef.current;
    saveStartingRef.current = true;
    let snapshot: Workbook;
    try {
      const commit = session.commitEdit();
      const accepted = typeof commit === "boolean" ? commit : await commit;
      if (!accepted || getMutationFailure(true) || lifetimeRef.current !== lifetime) return false;
      if (session.hasPendingEdits()) { reportError(new Error("編集中の内容を確定してください")); return false; }
      snapshot = workbookRef.current;
      if (workbooksEqual(snapshot, savedRef.current)) { edit.finishEdit("saved"); return true; }
      if (edit.getEditState().mode !== "edit") {
        const permission = edit.requestEdit({ action: "save", source: "ui" });
        const requestedId = edit.getEditState().requestId;
        const allowed = typeof permission === "boolean" ? permission : await permission;
        if (!allowed || !requestedId || edit.getEditState().requestId !== requestedId || getMutationFailure(true) || lifetimeRef.current !== lifetime) return false;
        snapshot = workbookRef.current;
      }
    } finally { saveStartingRef.current = false; }
    if (!saveEnabled() || !propsRef.current.onSave) return false;
    const request = begin("save");
    if (!request) return false;
    const saveHandler = propsRef.current.onSave;
    const beforeSave = propsRef.current.onBeforeSave;
    const context = { requestId: request.id, signal: request.controller.signal };
    emitEvent({ type: "save", status: "start", requestId: request.id, workbook: snapshot });
    try {
      if (!current(request)) return false;
      if (beforeSave) {
        const validation = await beforeSave(snapshot, context);
        if (!current(request)) return false;
        if (validation === false) {
          emitEvent({ type: "save", status: "cancelled", requestId: request.id, reason: "validation" });
          return false;
        }
        if (validation !== undefined && validation !== true) throw new Error("保存前の確認結果が正しくありません");
      }
      if (!current(request)) return false;
      if (propsRef.current.readOnly || !propsRef.current.onSave || !saveEnabled() || edit.getEditState().mode !== "edit") {
        emitEvent({ type: "save", status: "cancelled", requestId: request.id, reason: "aborted" });
        return false;
      }
      const response = await saveHandler(snapshot, context);
      if (!current(request)) return false;
      const accepted = normalizeWorkbook(response === undefined ? snapshot : response);
      transactionRef.current = true;
      try {
        replaceBaseline(accepted);
        session.resetView(accepted);
        emitEvent({ type: "save", status: "success", requestId: request.id, workbook: accepted });
        edit.finishEdit("saved");
      } finally { transactionRef.current = false; }
      return true;
    } catch (cause) {
      if (!current(request)) return false;
      if (cause instanceof Error && cause.name === "AbortError")
        emitEvent({ type: "save", status: "cancelled", requestId: request.id, reason: "aborted" });
      else {
        const message = cause instanceof Error && cause.message ? cause.message : "保存できませんでした";
        reportError(new Error(message));
        emitEvent({ type: "save", status: "error", requestId: request.id, message });
      }
      return false;
    } finally { finish(request); }
  };
  const refresh = async (session: WorkbookViewSession, consent: SpreadsheetDiscardOptions = {}): Promise<boolean> => {
    const handler = propsRef.current.onRefresh;
    if (options.contextMenuOwnerRef?.current || !lifetimeRef.current || !handler || propsRef.current.features?.refresh === false || active.current ||
      saveStartingRef.current || transactionRef.current || edit.getEditState().mode === "requesting" || edit.isEndingEdit()) return false;
    if (!consent.discardChanges && (session.hasPendingEdits() || !workbooksEqual(workbookRef.current, savedRef.current))) return false;
    const request = begin("refresh");
    if (!request) return false;
    emitEvent({ type: "refresh", status: "start", requestId: request.id });
    try {
      if (!current(request)) return false;
      const response = await handler({ requestId: request.id, signal: request.controller.signal });
      if (!current(request)) return false;
      if (!response || typeof response !== "object") throw new Error("再読み込みの結果が正しくありません");
      const accepted = normalizeWorkbook(response);
      transactionRef.current = true;
      try {
        replaceBaseline(accepted);
        session.resetView(accepted);
        emitEvent({ type: "refresh", status: "success", requestId: request.id, workbook: accepted });
        edit.finishEdit("refreshed");
      } finally { transactionRef.current = false; }
      return true;
    } catch (cause) {
      if (!current(request)) return false;
      if (cause instanceof Error && cause.name === "AbortError") emitEvent({ type: "refresh", status: "cancelled", requestId: request.id });
      else {
        const message = cause instanceof Error && cause.message ? cause.message : "再読み込みできませんでした";
        reportError(new Error(message));
        emitEvent({ type: "refresh", status: "error", requestId: request.id, message });
      }
      return false;
    } finally { finish(request); }
  };
  const discard = (session: WorkbookViewSession, consent: SpreadsheetDiscardOptions = {}): boolean => {
    if (options.contextMenuOwnerRef?.current || !lifetimeRef.current || active.current || transactionRef.current || saveStartingRef.current || edit.isEndingEdit()) return false;
    const changed = !workbooksEqual(workbookRef.current, savedRef.current);
    if (!consent.discardChanges && (changed || session.hasPendingEdits())) return false;
    transactionRef.current = true;
    try {
      replaceBaseline(savedRef.current);
      session.resetView(savedRef.current);
      if (changed) emitEvent({ type: "discard", workbook: savedRef.current });
      edit.finishEdit("discarded");
      return true;
    } finally { transactionRef.current = false; }
  };
  return { saving, refreshing, save, refresh, discard };
}
