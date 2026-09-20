"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetImportExcelOptions, SpreadsheetImportNativeOptions } from "../api/lifecycle";
import type { SpreadsheetExcelImportResult } from "../import/types";
import { normalizeWorkbook, parseWorkbook, SPREADSHEET_LIMITS } from "../model";
import type { DraftSelection, Workbook } from "./types";
import type { useWorkbookDraft } from "./use-workbook-draft";

type ImportView = DraftSelection & {
  hasPendingEdits: () => boolean;
  capturePendingEdits: () => () => boolean;
  resetView: (workbook: Workbook) => void;
  isExporting: () => boolean;
};
const cancelled = (message = "取り込みをキャンセルしました") => new DOMException(message, "AbortError");

/** Parsing and review retain the old draft; the existing transaction publishes exactly once. */
export function useSpreadsheetImport(draft: ReturnType<typeof useWorkbookDraft>, view: ImportView) {
  const latest = useRef({ draft, view });
  useLayoutEffect(() => { latest.current = { draft, view }; });
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const [importingFormat, setImportingFormat] = useState<"xlsx" | "spon" | null>(null);
  const activeFormat = useRef<"xlsx" | "spon">("xlsx");
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (draft.readOnly || draft.propsRef.current.features?.[activeFormat.current === "xlsx" ? "importExcel" : "importNative"] === false) active.current?.abort();
  });
  const cancelImport = useCallback(() => { active.current?.abort(); }, []);
  const runImport = useCallback(async (input: Blob | ArrayBuffer | Uint8Array,
    options: SpreadsheetImportExcelOptions = {}, source: "ui" | "api" = "api", format: "xlsx" | "spon" = "xlsx"): Promise<SpreadsheetExcelImportResult> => {
    const feature = format === "xlsx" ? "importExcel" : "importNative";
    const label = format === "xlsx" ? "Excel" : "SPON";
    const { draft: current, view: currentView } = latest.current;
    if (!mounted.current) throw new Error("スプレッドシートは表示されていません");
    if (current.propsRef.current.features?.[feature] === false) throw new Error(`${label}取り込みは無効です`);
    const failure = current.getMutationFailure();
    if (failure) throw new Error(failure.message);
    if (active.current || current.isOperationPending() || currentView.isExporting())
      throw new Error("処理が完了してからファイルを取り込んでください");
    if (options.discardChanges !== true && (current.isDirty() || currentView.hasPendingEdits()))
      throw new Error("未保存の変更や入力中の編集があります。取り込むには discardChanges: true を指定してください");
    options.signal?.throwIfAborted();
    const controller = new AbortController(), requestId = crypto.randomUUID();
    const fileName = typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name : undefined;
    const eventBase = { type: "import" as const, format, requestId, ...(fileName ? { fileName } : {}) };
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
    active.current = controller; activeFormat.current = format; setImportingFormat(format);
    const ensureCurrent = () => {
      if (controller.signal.aborted || !mounted.current || active.current !== controller ||
        current.propsRef.current.features?.[feature] === false || current.propsRef.current.readOnly || !current.propsRef.current.onSave)
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
      if (format === "xlsx" && fileName && !/\.xlsx$/i.test(fileName)) throw new Error(".xlsx 形式のExcelファイルを選択してください");
      const parsed = format === "xlsx"
        ? await wait(import("../import/import-xlsx").then(({ importSpreadsheetXlsx }) => importSpreadsheetXlsx(input, { signal: controller.signal })))
        : await wait((async () => {
          if (!input || typeof input !== "object" || !("text" in input) || typeof input.text !== "function" || !("size" in input))
            throw new Error("SPONファイルはBlobで指定してください");
          // UTF-8 uses at most three bytes per UTF-16 code unit. The parser also checks decoded length.
          if (input.size > SPREADSHEET_LIMITS.serializedCharacters * 3) throw new Error("SPONファイルが大きすぎます");
          const json = await input.text();
          ensureCurrent();
          return { workbook: parseWorkbook(json), warnings: [] };
        })());
      ensureCurrent();
      // Freeze a validated copy before host review so approval cannot mutate the candidate.
      const result: SpreadsheetExcelImportResult = Object.freeze({ workbook: normalizeWorkbook(parsed.workbook),
        warnings: Object.freeze(parsed.warnings.map(warning => Object.freeze({ ...warning }))) });
      if (options.onReview) {
        const accepted = await wait(options.onReview(result));
        ensureCurrent();
        if (accepted === false) throw cancelled();
        if (accepted !== true) throw new Error("取り込みの確認結果が正しくありません");
      }
      ensureCurrent();
      const committed = current.applyTransaction(() => result.workbook, currentView, {
        source, action: feature, isCurrent: () => {
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
      else current.emitEvent({ ...eventBase, status: "error", message: cause instanceof Error ? cause.message : "ファイルの取り込みに失敗しました" });
      throw aborted && !(cause instanceof Error && cause.name === "AbortError") ? cancelled() : cause;
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      controller.signal.removeEventListener("abort", cancelPermission);
      if (active.current === controller) { active.current = null; if (mounted.current) setImportingFormat(null); }
    }
  }, []);
  return { importing: importingFormat !== null, importingFormat, cancelImport, isImporting: () => active.current !== null,
    importExcel: (input: Blob | ArrayBuffer | Uint8Array, options?: SpreadsheetImportExcelOptions) => runImport(input, options),
    importExcelFromUi: (input: Blob, options?: SpreadsheetImportExcelOptions) => runImport(input, options, "ui"),
    importNative: (input: Blob, options?: SpreadsheetImportNativeOptions) => runImport(input, options, "api", "spon"),
    importNativeFromUi: (input: Blob, options?: SpreadsheetImportNativeOptions) => runImport(input, options, "ui", "spon") };
}
