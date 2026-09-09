"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetExcelExportOptions } from "../export/types";
import { exportSpreadsheetXlsx } from "../export/export-xlsx";
import type { useWorkbookDraft } from "./use-workbook-draft";

/** Exports an immutable snapshot; it never acquires a lease or changes the save baseline. */
export function useSpreadsheetExport(draft: ReturnType<typeof useWorkbookDraft>, hasPendingEdits: () => boolean) {
  const latest = useRef({ draft, hasPendingEdits });
  useLayoutEffect(() => { latest.current = { draft, hasPendingEdits }; });
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const [exporting, setExporting] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (draft.propsRef.current.features?.exportExcel === false) active.current?.abort();
  });
  const cancelExport = useCallback(() => { active.current?.abort(); }, []);
  const exportExcel = useCallback(async (options: SpreadsheetExcelExportOptions = {}): Promise<Blob> => {
    const { draft: current, hasPendingEdits: pending } = latest.current;
    if (!mounted.current) throw new Error("スプレッドシートは表示されていません");
    if (current.propsRef.current.features?.exportExcel === false) throw new Error("Excel出力は無効です");
    if (pending()) throw new Error("入力中の編集を確定してからExcel出力してください");
    if (active.current || current.isOperationPending())
      throw new Error("処理が完了してからExcel出力してください");
    options.signal?.throwIfAborted();
    const controller = new AbortController(), requestId = crypto.randomUUID();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    active.current = controller; setExporting(true);
    const workbook = current.workbookRef.current;
    current.emitEvent({ type: "export", format: "xlsx", status: "start", requestId, workbook });
    try {
      const blob = await exportSpreadsheetXlsx(workbook, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (latest.current.draft.propsRef.current.features?.exportExcel === false) throw new DOMException("Export cancelled", "AbortError");
      current.emitEvent({ type: "export", format: "xlsx", status: "success", requestId, size: blob.size });
      return blob;
    } catch (cause) {
      if (mounted.current) {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError"))
          current.emitEvent({ type: "export", format: "xlsx", status: "cancelled", requestId });
        else current.emitEvent({ type: "export", format: "xlsx", status: "error", requestId,
          message: cause instanceof Error ? cause.message : "Excel出力に失敗しました" });
      }
      throw cause;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (active.current === controller) { active.current = null; setExporting(false); }
    }
  }, []);
  return { exportExcel, exporting, cancelExport };
}
