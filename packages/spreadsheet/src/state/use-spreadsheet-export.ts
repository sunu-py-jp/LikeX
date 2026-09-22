"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetExcelExportOptions, SpreadsheetNativeExportOptions } from "../export/types";
import { serializeWorkbook } from "../model";
import { exportSpreadsheetXlsx } from "../export/export-xlsx";
import type { useWorkbookDraft } from "./use-workbook-draft";

/** Exports an immutable snapshot; it never acquires a lease or changes the save baseline. */
export function useSpreadsheetExport(draft: ReturnType<typeof useWorkbookDraft>, hasPendingEdits: () => boolean) {
  const latest = useRef({ draft, hasPendingEdits });
  useLayoutEffect(() => { latest.current = { draft, hasPendingEdits }; });
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "spon" | null>(null);
  const activeFormat = useRef<"xlsx" | "spon">("xlsx");
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (draft.propsRef.current.features?.[activeFormat.current === "xlsx" ? "exportExcel" : "exportNative"] === false) active.current?.abort();
  });
  const cancelExport = useCallback(() => { active.current?.abort(); }, []);
  const runExport = useCallback(async (format: "xlsx" | "spon", options: SpreadsheetExcelExportOptions = {}): Promise<Blob> => {
    const feature = format === "xlsx" ? "exportExcel" : "exportNative";
    const label = format === "xlsx" ? "Excel" : "SPON";
    const { draft: current, hasPendingEdits: pending } = latest.current;
    if (!mounted.current) throw new Error("スプレッドシートは表示されていません");
    if (current.propsRef.current.features?.[feature] === false) throw new Error(`${label}出力は無効です`);
    if (pending()) throw new Error("入力中の編集を確定してから出力してください");
    if (active.current || current.isOperationPending())
      throw new Error("処理が完了してから出力してください");
    options.signal?.throwIfAborted();
    const controller = new AbortController(), requestId = crypto.randomUUID();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    active.current = controller; activeFormat.current = format; setExportingFormat(format);
    const workbook = current.workbookRef.current;
    current.emitEvent({ type: "export", format, status: "start", requestId, workbook });
    try {
      controller.signal.throwIfAborted();
      const blob = await (format === "xlsx" ? exportSpreadsheetXlsx(workbook, { ...options, signal: controller.signal })
        : new Blob([serializeWorkbook(workbook)], { type: "application/json" }));
      controller.signal.throwIfAborted();
      if (latest.current.draft.propsRef.current.features?.[feature] === false) throw new DOMException("Export cancelled", "AbortError");
      current.emitEvent({ type: "export", format, status: "success", requestId, size: blob.size });
      return blob;
    } catch (cause) {
      if (mounted.current) {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError"))
          current.emitEvent({ type: "export", format, status: "cancelled", requestId });
        else current.emitEvent({ type: "export", format, status: "error", requestId,
          message: cause instanceof Error ? cause.message : "ファイルの出力に失敗しました" });
      }
      throw cause;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (active.current === controller) { active.current = null; setExportingFormat(null); }
    }
  }, []);
  return { exportExcel: (options?: SpreadsheetExcelExportOptions) => runExport("xlsx", options),
    exportNative: (options?: SpreadsheetNativeExportOptions) => runExport("spon", options),
    exporting: exportingFormat !== null, exportingFormat, cancelExport, isExporting: () => active.current !== null };
}
