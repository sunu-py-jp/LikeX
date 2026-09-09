"use client";

import { useMemo, useState } from "react";
import { addSheet, deleteSheet, renameSheet } from "../model";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { MAX_SELECTION_CELLS, selectedAddresses } from "../state/selection";
import { selectionCellCount, selectionRanges } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetFooter({ controller: c }: { controller: SpreadsheetController }) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const stats = useMemo(() => {
    const count = selectionCellCount(c.selection);
    const ranges = selectionRanges(c.selection).length;
    const prefix = ranges > 1 ? `${ranges} 範囲・` : "";
    if (count > MAX_SELECTION_CELLS) return `${prefix}${count.toLocaleString()} セルを選択`;
    let filled = 0, numeric = 0, sum = 0;
    for (const address of selectedAddresses(c.selection)) {
      const value = c.calculated[c.activeSheet.id]?.[address];
      if (value !== undefined && value !== "") filled++;
      if (typeof value === "number" && Number.isFinite(value)) { numeric++; sum += value; }
    }
    return numeric > 1 ? `${prefix}平均: ${Number((sum / numeric).toFixed(4)).toLocaleString()}　データ数: ${filled}　合計: ${Number(sum.toFixed(4)).toLocaleString()}` : `${prefix}${count.toLocaleString()} セルを選択`;
  }, [c.selection, c.calculated, c.activeSheet.id]);
  const commitName = () => {
    if (!renaming) return;
    if (c.apply(wb => renameSheet(wb, renaming.id, renaming.value))) setRenaming(null);
  };
  return <>
    <footer className="lxs-footer">
      {c.features.sheets ? <div className="lxs-sheet-tabs" role="tablist" aria-label="ワークシート">
        {c.workbook.sheets.map(sheet => renaming?.id === sheet.id ? <input key={sheet.id} autoFocus className="lxs-sheet-name-input" aria-label="シート名" value={renaming.value} maxLength={31} onFocus={event => event.currentTarget.select()} onChange={event => setRenaming({ id: sheet.id, value: event.target.value })} onBlur={commitName} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); commitName(); }
          if (event.key === "Escape") { event.preventDefault(); setRenaming(null); }
        }} /> : <button key={sheet.id} type="button" role="tab" aria-selected={sheet.id === c.activeSheet.id} className={`lxs-sheet-tab ${sheet.id === c.activeSheet.id ? "lxs-sheet-tab-active" : ""}`} onClick={() => c.switchSheet(sheet.id)} onDoubleClick={() => { if (!c.disabled) setRenaming({ id: sheet.id, value: sheet.name }); }}>{sheet.name}</button>)}
        {!c.readOnly && <>
          <Command label="シートを追加" disabled={c.disabled} onClick={() => {
            if (!c.commitEdit()) return;
            let id: string | undefined;
            if (c.apply(wb => { const next = addSheet(wb); id = next.sheets.at(-1)?.id; return next; }) && id) c.switchSheet(id);
          }}><Icon name="plus" /></Command>
          <select aria-label="シートの操作" className="lxs-sheet-menu" value="" disabled={c.disabled} onChange={event => {
            if (event.target.value === "rename") setRenaming({ id: c.activeSheet.id, value: c.activeSheet.name });
            if (event.target.value === "delete" && c.commitEdit()) c.apply(wb => deleteSheet(wb, c.activeSheet.id));
          }}><option value="" disabled>シート操作</option><option value="rename">名前を変更</option><option value="delete" disabled={c.workbook.sheets.length < 2}>{c.features.undoRedo ? "削除（元に戻す可）" : "削除"}</option></select>
        </>}
      </div> : <span className="lxs-sheet-label">{c.activeSheet.name}</span>}
      <span className="lxs-selection-stats" aria-live="polite">{stats}</span>
    </footer>
    {c.error && <div className="lxs-error" role="alert"><span>{c.error}</span><Command label="エラー表示を閉じる" onClick={() => c.setError(null)}><Icon name="close" /></Command></div>}
  </>;
}
