"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { MAX_SELECTION_CELLS, selectedAddresses } from "../state/selection";
import { selectionCellCount, selectionRanges } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";
import { useObjectEditPending } from "../state/use-object-edit-pending";
import { useSheetTabReorder } from "./sheets/use-sheet-tab-reorder";
import { SpreadsheetZoomControls } from "./spreadsheet-zoom-controls";
import { HorizontalScrollStrip } from "./horizontal-scroll-strip";

export function SpreadsheetFooter({ controller: c }: { controller: SpreadsheetController }) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const reorder = useSheetTabReorder(c, renaming !== null);
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
  const beginRename = (sheet: { id: string; name: string }) => {
    if (c.readOnly || c.disabled || c.requesting || !c.features.renameSheet) return;
    c.afterCommit(() => setRenaming({ id: sheet.id, value: sheet.name }));
  };
  return <>
    <footer className="lxs-footer">
      {c.features.sheets ? <HorizontalScrollStrip className="lxs-sheet-tabs" role="tablist" aria-label="ワークシート"
        itemSelector=".lxs-sheet-tab, .lxs-sheet-name-input, .lxs-command" previousLabel="左のシートを表示" nextLabel="右のシートを表示"
        onDragOver={reorder.onDragOver} onDrop={reorder.onDrop} onDragLeave={reorder.onDragLeave}>
        {c.workbook.sheets.map(sheet => renaming?.id === sheet.id && c.features.renameSheet && !c.readOnly ? <input key={sheet.id} autoFocus className="lxs-sheet-name-input" aria-label="シート名" value={renaming.value} readOnly={c.disabled || c.requesting} maxLength={31} onFocus={event => event.currentTarget.select()} onChange={event => { setRenaming({ id: sheet.id, value: event.target.value }); markPending(event.target.value !== sheet.name); }} onBlur={commitName} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); commitName(); }
          if (event.key === "Escape") { event.preventDefault(); c.cancelEditRequest(); markPending(false); setRenaming(null); }
        }} /> : <button key={sheet.id} type="button" role="tab" data-lxs-sheet-id={sheet.id} aria-selected={sheet.id === c.activeSheet.id}
          draggable={reorder.enabled} aria-keyshortcuts={reorder.enabled ? "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" : undefined}
          className={`lxs-sheet-tab ${sheet.id === c.activeSheet.id ? "lxs-sheet-tab-active" : ""} ${reorder.draggingId === sheet.id ? "lxs-sheet-tab-dragging" : ""} ${reorder.dropPosition?.beforeId === sheet.id ? "lxs-sheet-drop-before" : ""}`}
          onPointerDown={reorder.onPointerDown} onDragStart={event => reorder.onDragStart(event, sheet.id)} onDragEnd={reorder.onDragEnd}
          onKeyDown={event => reorder.onKeyDown(event, sheet.id)} onClick={event => {
          if (reorder.ignoreClick(event?.detail)) return;
          if (sheet.id === c.activeSheet.id) beginRename(sheet);
          else c.switchSheet(sheet.id);
        }} onDoubleClick={event => { if (!reorder.ignoreClick(event?.detail)) beginRename(sheet); }}>{sheet.name}</button>)}
        {reorder.dropPosition?.beforeId === null && <span className="lxs-sheet-drop-end" aria-hidden="true" />}
        {!c.readOnly && <>
          {c.features.createSheet && <Command label="シートを追加" disabled={c.disabled || c.requesting} onClick={() => {
            c.afterCommit(() => c.afterCommand({ type: "sheets.add" }, result => {
              if (result.results[0]?.sheetId) c.switchSheet(result.results[0].sheetId);
            }));
          }}><Icon name="plus" /></Command>}
        </>}
      </HorizontalScrollStrip> : <span className="lxs-sheet-label">{c.activeSheet.name}</span>}
    </footer>
    <div className="lxs-status-bar" data-error={!!c.error || undefined}>
      {c.error ? <div className="lxs-status-error" role="alert">
        <span className="lxs-status-error-message" title={c.error}>{c.error}</span>
        <Command label="エラー表示を閉じる" onClick={() => c.setError(null)}><Icon name="close" /></Command>
      </div> : <span className="lxs-selection-stats" aria-live="polite">{stats}</span>}
      <SpreadsheetZoomControls controller={c} />
    </div>
  </>;
}
