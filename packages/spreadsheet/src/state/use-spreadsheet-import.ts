"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetImportExcelOptions } from "../api/lifecycle";
import type { SpreadsheetExcelImportResult } from "../import/types";
import { normalizeWorkbook } from "../model";
import type { DraftSelection, Workbook } from "./types";
import type { useWorkbookDraft } from "./use-workbook-draft";

type ImportView = DraftSelection & {
  hasPendingEdits: () => boolean;
  capturePendingEdits: () => () => boolean;
  resetView: (workbook: Workbook) => void;
  isExporting: () => boolean;
};
const cancelled = (message = "Excel取り込みをキャンセルしました") => new DOMException(message, "AbortError");

/** Parsing and review retain the old draft; the existing transaction publishes exactly once. */
export function useSpreadsheetImport(draft: ReturnType<typeof useWorkbookDraft>, view: ImportView) {
  const latest = useRef({ draft, view });
  useLayoutEffect(() => { latest.current = { draft, view }; });
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const [importing, setImporting] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (draft.readOnly || draft.propsRef.current.features?.importExcel === false) active.current?.abort();
  });
  const cancelImport = useCallback(() => { active.current?.abort(); }, []);
  const runImport = useCallback(async (input: Blob | ArrayBuffer | Uint8Array,
    options: SpreadsheetImportExcelOptions = {}, source: "ui" | "api" = "api"): Promise<SpreadsheetExcelImportResult> => {
    const { draft: current, view: currentView } = latest.current;
    if (!mounted.current) throw new Error("スプレッドシートは表示されていません");
    if (current.propsRef.current.features?.importExcel === false) throw new Error("Excel取り込みは無効です");
    const failure = current.getMutationFailure();
    if (failure) throw new Error(failure.message);
    if (active.current || current.isOperationPending() || currentView.isExporting())
      throw new Error("処理が完了してからExcelを取り込んでください");
    if (options.discardChanges !== true && (current.isDirty() || currentView.hasPendingEdits()))
      throw new Error("未保存の変更や入力中の編集があります。取り込むには discardChanges: true を指定してください");
    options.signal?.throwIfAborted();
    const controller = new AbortController(), requestId = crypto.randomUUID();
    const fileName = typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name : undefined;
    const eventBase = { type: "import" as const, format: "xlsx" as const, requestId, ...(fileName ? { fileName } : {}) };
    const workbook = current.workbookRef.current, revision = current.revisionRef.current;
    const pendingUnchanged = currentView.capturePendingEdits();
    let permissionId: string | null = null;
    let published = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    const cancelPermission = () => {
      if (permissionId && current.getEditState().requestId === permissionId) current.cancelEditRequest();
    };
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    controller.signal.addEventListener("abort", cancelPermission);
    active.current = controller; setImporting(true);
    const ensureCurrent = () => {
      if (controller.signal.aborted || !mounted.current || active.current !== controller ||
        current.propsRef.current.features?.importExcel === false || current.propsRef.current.readOnly || !current.propsRef.current.onSave)
        throw cancelled();
      if (current.workbookRef.current !== workbook || current.revisionRef.current !== revision || !pendingUnchanged())
        throw cancelled("取り込み中に編集内容が変わりました。内容を確認して取り込み直してください");
    };
    const wait = <T,>(value: PromiseLike<T> | T, committing = false): Promise<T> => new Promise((resolve, reject) => {
      const abort = () => { if (!committing || !published) reject(cancelled()); };
      if (controller.signal.aborted && (!committing || !published)) { abort(); return; }
      controller.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(value).then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
    });
    current.emitEvent({ ...eventBase, status: "start" });
    try {
      ensureCurrent();
      if (fileName && !/\.xlsx$/i.test(fileName)) throw new Error(".xlsx 形式のExcelファイルを選択してください");
      const parsed = await wait(import("../import/import-xlsx").then(({ importSpreadsheetXlsx }) =>
        importSpreadsheetXlsx(input, { signal: controller.signal })));
      ensureCurrent();
      // Freeze a validated copy before host review so approval cannot mutate the candidate.
      const result: SpreadsheetExcelImportResult = Object.freeze({ workbook: normalizeWorkbook(parsed.workbook),
        warnings: Object.freeze(parsed.warnings.map(warning => Object.freeze({ ...warning }))) });
      if (options.onReview) {
        const accepted = await wait(options.onReview(result));
        ensureCurrent();
        if (accepted === false) throw cancelled();
        if (accepted !== true) throw new Error("Excel取り込みの確認結果が正しくありません");
      }
      ensureCurrent();
      const committed = current.applyTransaction(() => result.workbook, currentView, {
        source, action: "importExcel", isCurrent: () => {
          try { ensureCurrent(); return true; } catch { return false; }
        },
        beforePublish: () => { latest.current.view.resetView(result.workbook); published = true; },
      });
      if (committed instanceof Promise && current.getEditState().mode === "requesting") permissionId = current.getEditState().requestId;
      if (controller.signal.aborted) cancelPermission();
      const applied = committed instanceof Promise ? await wait(committed, true) : committed;
      if (!applied.ok) {
        ensureCurrent();
        if (applied.code === "EDIT_CANCELLED" || applied.code === "STALE_TARGET") throw cancelled(applied.message);
        throw new Error(applied.message);
      }
      if (!applied.changed) latest.current.view.resetView(current.workbookRef.current);
      current.emitEvent({ ...eventBase, status: "success", workbook: result.workbook, warnings: result.warnings });
      return result;
    } catch (cause) {
      const aborted = controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError");
      if (aborted) current.emitEvent({ ...eventBase, status: "cancelled" });
      else current.emitEvent({ ...eventBase, status: "error", message: cause instanceof Error ? cause.message : "Excel取り込みに失敗しました" });
      throw aborted && !(cause instanceof Error && cause.name === "AbortError") ? cancelled() : cause;
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      controller.signal.removeEventListener("abort", cancelPermission);
      if (active.current === controller) { active.current = null; if (mounted.current) setImporting(false); }
    }
  }, []);
  return { importing, cancelImport, isImporting: () => active.current !== null,
    importExcel: (input: Blob | ArrayBuffer | Uint8Array, options?: SpreadsheetImportExcelOptions) => runImport(input, options),
    importExcelFromUi: (input: Blob, options?: SpreadsheetImportExcelOptions) => runImport(input, options, "ui") };
}
