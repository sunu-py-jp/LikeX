"use client";

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { downloadXlsx } from "../export/download-xlsx";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetExportControls({ controller: c }: { controller: SpreadsheetController }) {
  if (!c.features.exportExcel) return null;
  const start = async (button: HTMLButtonElement) => {
    try {
      if (!await c.commitEdit()) return;
      const blob = await c.exportExcel();
      if (button.isConnected) downloadXlsx(blob, c.exportFileName, button.ownerDocument);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) c.reportError(cause);
    }
  };
  return <>
    <Command label="Excelにエクスポート" disabled={c.exporting || c.saving || c.refreshing || c.requesting || c.contextMenuLocked}
      onClick={event => void start(event.currentTarget)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg>
      {c.exporting ? "Excel出力中…" : "Excel出力"}
    </Command>
    {c.exporting && <Command label="Excel出力をキャンセル" onClick={c.cancelExport}><Icon name="close" /></Command>}
  </>;
}
