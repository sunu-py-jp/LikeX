"use client";

import { useState } from "react";
import { cellAddress, mergeCells, mergedContentWouldBeDiscarded, rangesIntersect, unmergeCells, type SpreadsheetMergedRange } from "../model";
import { MAX_SELECTION_CELLS, selectionBounds, type SpreadsheetController, type Workbook } from "../state/use-spreadsheet";
import { isMultiRangeSelection } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";
import { SpreadsheetConfirmDialog } from "./spreadsheet-confirm-dialog";

export function SpreadsheetMergeToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const [pending, setPending] = useState<{ workbook: Workbook; sheetId: string; range: SpreadsheetMergedRange } | null>(null);
  const bounds = selectionBounds(c.selection);
  const count = (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
  const multiple = isMultiRangeSelection(c.selection);
  const intersects = c.activeSheet.merges?.some(range => rangesIntersect(range, bounds));
  const exact = c.activeSheet.merges?.some(range => range.top === bounds.top && range.left === bounds.left && range.bottom === bounds.bottom && range.right === bounds.right);
  const disabled = c.disabled || !!c.selectedDrawingId || multiple;
  const mergeDisabled = disabled || count < 2 || count > MAX_SELECTION_CELLS || !!exact;
  const hint = multiple ? "1つの連続した範囲を選択してください" : count > MAX_SELECTION_CELLS ? "結合できる範囲は10,000セルまでです" : undefined;
  const requestMerge = () => {
    if (!c.features.mergeCells || mergeDisabled || !c.commitEdit()) return;
    // Read the latest draft after committing an in-progress cell edit.
    c.apply(workbook => {
      const sheet = workbook.sheets.find(item => item.id === c.activeSheet.id)!;
      if (mergedContentWouldBeDiscarded(sheet, bounds)) {
        setPending({ workbook, sheetId: sheet.id, range: bounds });
        return workbook;
      }
      return mergeCells(workbook, sheet.id, bounds);
    });
  };
  const confirmMerge = () => {
    if (!pending || !c.features.mergeCells || c.disabled) return;
    const accepted = c.apply(workbook => {
      if (workbook !== pending.workbook) throw new Error("確認中にブックが変更されました。範囲を選択してもう一度結合してください");
      return mergeCells(workbook, pending.sheetId, pending.range, { discardValues: true });
    });
    setPending(null);
    if (accepted) c.requestGridFocus();
  };
  if (!c.features.mergeCells || c.readOnly) return null;
  return <>
    <div className="lxs-tool-group">
      <Command label="セルを結合" title={hint} disabled={mergeDisabled} onClick={requestMerge}><Icon name="merge" /></Command>
      <Command label="結合を解除" title={multiple ? hint : undefined} disabled={disabled || !intersects} onClick={() => {
        if (!c.features.mergeCells || disabled || !intersects || !c.commitEdit()) return;
        if (c.apply(workbook => unmergeCells(workbook, c.activeSheet.id, bounds))) c.requestGridFocus();
      }}><Icon name="unmerge" /></Command>
    </div>
    {pending && <SpreadsheetConfirmDialog title="セルを結合しますか？" confirmLabel="結合する" disabled={c.disabled} onConfirm={confirmMerge} onCancel={() => setPending(null)}>
      <p>{cellAddress(pending.range.top, pending.range.left)} の値とコメントを残し、結合範囲にあるほかの値・数式・コメントを削除します。</p>
      <p>結合を解除しても、削除した内容は復元されません。{c.features.undoRedo ? "「元に戻す」で結合前に戻せます。" : ""}</p>
    </SpreadsheetConfirmDialog>}
  </>;
}
