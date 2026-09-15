"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetExcelImportResult } from "../import/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { SpreadsheetConfirmDialog } from "./spreadsheet-confirm-dialog";
import { SpreadsheetExportControls } from "./spreadsheet-export-controls";
import { HorizontalScrollStrip } from "./horizontal-scroll-strip";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetFileControls({ controller: c, active, panelId, tabId }: {
  controller: SpreadsheetController; active: boolean; panelId: string; tabId: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const reviewAnswer = useRef<((accepted: boolean) => void) | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [review, setReview] = useState<SpreadsheetExcelImportResult | null>(null);
  const available = c.features.importExcel && !c.readOnly;
  const busy = c.importing || c.exporting || c.saving || c.refreshing || c.requesting || c.contextMenuLocked;
  useLayoutEffect(() => () => { request.current?.abort(); reviewAnswer.current?.(false); }, []);
  const answer = (accepted: boolean) => {
    reviewAnswer.current?.(accepted); reviewAnswer.current = null; setReview(null);
  };
  const start = async (file: File, discardChanges = false) => {
    if (busy || !available || request.current) return;
    const controller = new AbortController(); request.current = controller;
    try {
      await c.importExcelFromUi(file, { signal: controller.signal, discardChanges,
        onReview: result => result.warnings.length === 0 ? true : new Promise<boolean>(resolve => {
          reviewAnswer.current = resolve; setReview(result);
        }) });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) c.reportError(cause);
      else if (cause.message.includes("編集内容が変わりました")) c.reportError(cause);
    } finally {
      if (request.current === controller) {
        request.current = null; reviewAnswer.current?.(false); reviewAnswer.current = null; setReview(null);
      }
    }
  };
  return <>
    <div role="tabpanel" id={panelId} aria-labelledby={tabId} hidden={!active}>
      <HorizontalScrollStrip className="lxs-ribbon" role="toolbar" aria-label="ファイルの操作" itemSelector=".lxs-ribbon-group"
        previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示">
        {available && <RibbonGroup label="取り込み">
          <input ref={input} type="file" accept=".xlsx" aria-label="取り込むExcelファイル" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (!file || busy) return;
            if (!/\.xlsx$/i.test(file.name)) { c.reportError(new Error(".xlsx 形式のExcelファイルを選択してください")); return; }
            if (c.hasUnsavedChanges || c.editing || c.pendingObjectEdit) setPendingFile(file);
            else void start(file);
          }} />
          <Command label="Excelからインポート" className="lxs-ribbon-command-large" disabled={busy}
            onMouseDown={event => event.preventDefault()} onClick={() => input.current?.click()}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5" /></svg>
            <span>Excel取り込み</span>
          </Command>
          {c.importing && <>
            <span role="status" className="lxs-operation-status" aria-live="polite"><svg className="lxs-import-spinner" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32 12" /></svg>{review ? "取り込み内容を確認してください" : "Excel取り込み中…"}</span>
            <Command label="Excel取り込みをキャンセル" onClick={c.cancelImport}><Icon name="close" /></Command>
          </>}
        </RibbonGroup>}
        {c.features.exportExcel && <RibbonGroup label="出力"><SpreadsheetExportControls controller={c} /></RibbonGroup>}
      </HorizontalScrollStrip>
    </div>
    {pendingFile && available && <SpreadsheetConfirmDialog title="変更を破棄してExcelを取り込みますか？" confirmLabel="取り込む" disabled={busy}
      onCancel={() => setPendingFile(null)} onConfirm={() => { const file = pendingFile; setPendingFile(null); void start(file, true); }}>
      未保存の変更や入力中の編集があります。Excelを取り込むと、ブック全体が置き換わります。取り込み後も、保存するまでは元の保存内容は変わりません。
    </SpreadsheetConfirmDialog>}
    {review && available && <SpreadsheetConfirmDialog title="取り込み内容の確認" confirmLabel="取り込む" onCancel={() => answer(false)} onConfirm={() => answer(true)}>
      <p>次の内容が変更または省略されます。確認してから取り込んでください。</p>
      <ul>{review.warnings.map((warning, index) => <li key={index}>{warning.sheetName ? `${warning.sheetName}: ` : ""}{warning.message}{warning.count && warning.count > 1 ? `（${warning.count}件）` : ""}</li>)}</ul>
    </SpreadsheetConfirmDialog>}
  </>;
}
