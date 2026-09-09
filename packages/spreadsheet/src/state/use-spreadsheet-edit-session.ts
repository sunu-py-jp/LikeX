"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { EditEndReason, MaybePromise } from "../core";
import type { SpreadsheetEditIntent, SpreadsheetEditRequest, SpreadsheetEditResult, SpreadsheetEditState, SpreadsheetEvent } from "../api/lifecycle";
import type { SpreadsheetCommandFailure } from "../api/types";
import type { SpreadsheetProps } from "../props";
import type { Workbook } from "./types";

type EditSession = { requestId: string; request: SpreadsheetEditRequest; controller: AbortController;
  phase: "requesting" | "edit"; cancel?: (allowed: boolean) => void };
type Options = {
  readOnly: boolean;
  propsRef: RefObject<SpreadsheetProps>;
  workbookRef: RefObject<Workbook>;
  unavailable: () => SpreadsheetCommandFailure | null;
  acceptBaseline: (workbook: Workbook) => void;
  emitEvent: (event: SpreadsheetEvent) => void;
};

/** A lease belongs to one edit session. Late responses cannot revive a released session. */
export function useSpreadsheetEditSession({ propsRef, workbookRef, unavailable, acceptBaseline, emitEvent, readOnly }: Options) {
  const record = useRef<EditSession | null>(null);
  const ending = useRef(false);
  const [state, setState] = useState<SpreadsheetEditState>({ mode: "view", requestId: null, error: null });
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const publish = useCallback((next: SpreadsheetEditState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  const finishEdit = useCallback((reason: EditEndReason | "denied" | "error", message?: string, expected = record.current) => {
    if (!expected || record.current !== expected || ending.current) return false;
    ending.current = true;
    try {
      record.current = null;
      publish({ mode: "view", requestId: null, error: message ?? null });
      expected.cancel?.(false);
      expected.controller.abort(reason);
      emitEvent({ type: "edit-mode", mode: "view", reason, requestId: expected.requestId, request: expected.request,
        ...(message ? { message } : {}) });
      return true;
    } finally { ending.current = false; }
  }, [emitEvent, publish]);

  useLayoutEffect(() => {
    mounted.current = true;
    publish(stateRef.current);
    return () => { mounted.current = false; finishEdit("unmounted"); };
  }, [finishEdit, publish]);
  useLayoutEffect(() => { if (readOnly) finishEdit("read-only"); }, [readOnly, finishEdit]);

  const getEditState = useCallback((): SpreadsheetEditState => {
    if (!mounted.current || propsRef.current.readOnly || !propsRef.current.onSave)
      return { ...stateRef.current, mode: "view", requestId: null };
    return { ...stateRef.current };
  }, [propsRef]);

  const requestEdit = useCallback((intent: SpreadsheetEditIntent = {}): MaybePromise<boolean> => {
    if (unavailable() || ending.current || !mounted.current) return false;
    if (record.current) return record.current.phase === "edit";
    const handler = propsRef.current.onEditRequest;
    const request: SpreadsheetEditRequest = Object.freeze({ source: intent.source ?? "api", action: intent.action ?? "edit",
      ...(intent.sheetId !== undefined ? { sheetId: intent.sheetId } : {}),
      ...(intent.commands ? { commands: Object.freeze([...intent.commands]) } : {}), workbook: workbookRef.current });
    const current: EditSession = { requestId: crypto.randomUUID(), request, controller: new AbortController(), phase: "requesting" };
    record.current = current;
    const isCurrent = () => mounted.current && !unavailable() && record.current === current && !current.controller.signal.aborted;
    const reject = (cause: unknown): false => {
      if (!isCurrent()) return false;
      if (cause instanceof Error && cause.name === "AbortError") finishEdit("cancelled", undefined, current);
      else finishEdit("error", cause instanceof Error && cause.message ? cause.message : "編集を開始できませんでした", current);
      return false;
    };
    const allow = (result: SpreadsheetEditResult): boolean => {
      if (!isCurrent()) return false;
      try {
        if (result === false) { finishEdit("denied", "他のユーザーが編集中のため変更できません", current); return false; }
        if (result !== true && (!result || typeof result !== "object" || result.allowed !== true))
          throw new Error("編集許可の結果が正しくありません");
        if (typeof result === "object" && result.workbook !== undefined) acceptBaseline(result.workbook);
        if (!isCurrent()) return false;
        current.phase = "edit";
        current.cancel = undefined;
        publish({ mode: "edit", requestId: current.requestId, error: null });
        emitEvent({ type: "edit-mode", mode: "edit", reason: "granted", requestId: current.requestId, request });
        return isCurrent();
      } catch (cause) { return reject(cause); }
    };
    if (!handler) return allow(true);
    publish({ mode: "requesting", requestId: current.requestId, error: null });
    const cancelled = new Promise<boolean>(resolve => { current.cancel = resolve; });
    emitEvent({ type: "edit-mode", mode: "requesting", reason: "request", requestId: current.requestId, request });
    if (!isCurrent()) return false;
    try {
      const result = handler(request, { requestId: current.requestId, signal: current.controller.signal });
      return result && typeof result === "object" && "then" in result
        ? Promise.race([Promise.resolve(result).then(allow, reject), cancelled]) : allow(result);
    } catch (cause) { return reject(cause); }
  }, [unavailable, propsRef, workbookRef, finishEdit, acceptBaseline, publish, emitEvent]);
  const cancelEditRequest = useCallback(() => {
    if (record.current?.phase === "requesting") finishEdit("cancelled");
  }, [finishEdit]);
  const isEndingEdit = useCallback(() => ending.current, []);
  return { editState: state, getEditState, requestEdit, cancelEditRequest, finishEdit, isEndingEdit };
}
