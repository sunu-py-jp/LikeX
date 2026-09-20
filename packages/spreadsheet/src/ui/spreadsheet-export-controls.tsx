"use client";

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { downloadWorkbook } from "../export/download-workbook";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetExportControls({ controller: c }: { controller: SpreadsheetController }) {
  const start = async (button: HTMLButtonElement, format: "xlsx" | "spon") => {
    try {
      if (!await c.commitEdit()) return;
      const blob = await (format === "xlsx" ? c.exportExcel() : c.exportNative());
      if (button.isConnected) downloadWorkbook(blob, c.exportFileName, format, button.ownerDocument);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) c.reportError(cause);
    }
  };
  return <>
    {(["spon", "xlsx"] as const).map(format => {
      if (!(format === "xlsx" ? c.features.exportExcel : c.features.exportNative)) return null;
      const label = format === "xlsx" ? "Excel" : "SPON";
      return <Command key={format} label={`${label}にエクスポート`} className="lxs-ribbon-command-large"
        disabled={c.exporting || c.importing || c.saving || c.refreshing || c.requesting || c.contextMenuLocked}
        onClick={event => void start(event.currentTarget, format)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg>
        <span>{c.exportingFormat === format ? `${label}出力中…` : format === "spon" ? "Spreadsheet (.spon)" : "Excel出力"}</span>
      </Command>;
    })}
    {c.exporting && <Command label={`${c.exportingFormat === "xlsx" ? "Excel" : "SPON"}出力をキャンセル`} onClick={c.cancelExport}><Icon name="close" /></Command>}
  </>;
}
