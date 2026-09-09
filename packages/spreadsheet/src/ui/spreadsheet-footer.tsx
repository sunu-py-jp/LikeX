"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { MAX_SELECTION_CELLS, selectedAddresses } from "../state/selection";
import { selectionCellCount, selectionRanges } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";
import { useObjectEditPending } from "../state/use-object-edit-pending";

export function SpreadsheetFooter({ controller: c }: { controller: SpreadsheetController }) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const markPending = useObjectEditPending(c);
  useLayoutEffect(() => {
    const original = c.workbook.sheets.find(sheet => sheet.id === renaming?.id);
    markPending(!!renaming && !!original && c.features.renameSheet && !c.readOnly && renaming.value !== original.name);
  }, [renaming, c.workbook.sheets, c.features.renameSheet, c.readOnly, markPending]);
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
    if (!renaming || c.requesting) return;
    c.afterCommand({ type: "sheets.rename", sheetId: renaming.id, name: renaming.value }, () => { markPending(false); setRenaming(null); });
  };
  return <>
    <footer className="lxs-footer">
      {c.features.sheets ? <div className="lxs-sheet-tabs" role="tablist" aria-label="ワークシート">
        {c.workbook.sheets.map(sheet => renaming?.id === sheet.id && c.features.renameSheet && !c.readOnly ? <input key={sheet.id} autoFocus className="lxs-sheet-name-input" aria-label="シート名" value={renaming.value} readOnly={c.disabled || c.requesting} maxLength={31} onFocus={event => event.currentTarget.select()} onChange={event => { setRenaming({ id: sheet.id, value: event.target.value }); markPending(event.target.value !== sheet.name); }} onBlur={commitName} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); commitName(); }
          if (event.key === "Escape") { event.preventDefault(); c.cancelEditRequest(); markPending(false); setRenaming(null); }
        }} /> : <button key={sheet.id} type="button" role="tab" aria-selected={sheet.id === c.activeSheet.id} className={`lxs-sheet-tab ${sheet.id === c.activeSheet.id ? "lxs-sheet-tab-active" : ""}`} onClick={() => c.switchSheet(sheet.id)} onDoubleClick={() => { if (!c.disabled && !c.requesting && c.features.renameSheet) setRenaming({ id: sheet.id, value: sheet.name }); }}>{sheet.name}</button>)}
        {!c.readOnly && <>
          {c.features.createSheet && <Command label="シートを追加" disabled={c.disabled || c.requesting} onClick={() => {
            c.afterCommit(() => c.afterCommand({ type: "sheets.add" }, result => {
              if (result.results[0]?.sheetId) c.switchSheet(result.results[0].sheetId);
            }));
          }}><Icon name="plus" /></Command>}
          {(c.features.renameSheet || c.features.deleteSheet) && <select aria-label="シートの操作" className="lxs-sheet-menu" value="" disabled={c.disabled || c.requesting} onChange={event => {
            if (event.target.value === "rename" && c.features.renameSheet) setRenaming({ id: c.activeSheet.id, value: c.activeSheet.name });
            if (event.target.value === "delete" && c.features.deleteSheet) c.afterCommit(() => c.afterCommand({ type: "sheets.delete", sheetId: c.activeSheet.id }));
          }}><option value="" disabled>シート操作</option>{c.features.renameSheet && <option value="rename">名前を変更</option>}{c.features.deleteSheet && <option value="delete" disabled={c.workbook.sheets.length < 2}>{c.features.undoRedo ? "削除（元に戻す可）" : "削除"}</option>}</select>}
        </>}
      </div> : <span className="lxs-sheet-label">{c.activeSheet.name}</span>}
      <span className="lxs-selection-stats" aria-live="polite">{stats}</span>
    </footer>
    {c.error && <div className="lxs-error" role="alert"><span>{c.error}</span><Command label="エラー表示を閉じる" onClick={() => c.setError(null)}><Icon name="close" /></Command></div>}
  </>;
}
