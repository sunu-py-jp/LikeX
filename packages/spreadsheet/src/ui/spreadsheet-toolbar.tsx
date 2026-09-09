"use client";

import { cellAddress, deleteColumns, deleteRows, formatCells, insertColumns, insertRows, parseCellAddress } from "../model";
import { selectedAddresses, selectionBounds, type SpreadsheetController } from "../state/use-spreadsheet";
import type { useSpreadsheetClipboard } from "../state/use-spreadsheet-clipboard";
import { Command, Icon } from "./spreadsheet-controls";
import { useState } from "react";

export function SpreadsheetToolbar({ controller: c, clipboard }: { controller: SpreadsheetController; clipboard: ReturnType<typeof useSpreadsheetClipboard> }) {
  const format = c.activeSheet.cells[cellAddress(c.selection.focus.row, c.selection.focus.column)]?.format;
  const formatSelection = (value: Parameters<typeof formatCells>[3]) => {
    if (!c.commitEdit()) return;
    c.apply(wb => formatCells(wb, c.activeSheet.id, selectedAddresses(c.selection), value));
  };
  const structural = (action: string) => {
    if (!c.commitEdit()) return;
    const { top, left, bottom, right } = selectionBounds(c.selection);
    c.apply(wb => action === "insert-row" ? insertRows(wb, c.activeSheet.id, top)
      : action === "insert-column" ? insertColumns(wb, c.activeSheet.id, left)
        : action === "delete-row" ? deleteRows(wb, c.activeSheet.id, top, bottom - top + 1)
          : deleteColumns(wb, c.activeSheet.id, left, right - left + 1));
  };
  return <div className="lxs-ribbon" role="toolbar" aria-label="シートの編集">
    {c.features.clipboard && <div className="lxs-tool-group">
      <Command label="コピー" onClick={() => { if (c.commitEdit()) void clipboard.copy(); }}><Icon name="copy" /></Command>
      {!c.readOnly && <><Command label="切り取り" disabled={c.disabled} onClick={() => { if (c.commitEdit()) void clipboard.copy(true); }}><Icon name="cut" /></Command>
        <Command label="貼り付け" disabled={c.disabled} onClick={() => { if (c.commitEdit()) void clipboard.paste(); }}><Icon name="paste" /></Command></>}
    </div>}
    {c.features.undoRedo && !c.readOnly && <div className="lxs-tool-group">
      <Command label="元に戻す" disabled={c.disabled || !c.canUndo} onClick={c.undo}><Icon name="undo" /></Command>
      <Command label="やり直す" disabled={c.disabled || !c.canRedo} onClick={c.redo}><Icon name="redo" /></Command>
    </div>}
    {c.features.formatting && !c.readOnly && <>
      <div className="lxs-tool-group">
        <Command label="太字" aria-pressed={!!format?.bold} disabled={c.disabled} onClick={() => formatSelection({ bold: !format?.bold })}><strong>B</strong></Command>
        <Command label="斜体" aria-pressed={!!format?.italic} disabled={c.disabled} onClick={() => formatSelection({ italic: !format?.italic })}><i>I</i></Command>
        <Command label="下線" aria-pressed={!!format?.underline} disabled={c.disabled} onClick={() => formatSelection({ underline: !format?.underline })}><u>U</u></Command>
        <label className="lxs-color-control" title="文字色"><span aria-hidden="true">A</span><input aria-label="文字色" type="color" disabled={c.disabled} value={format?.color ?? "#202124"} onChange={event => formatSelection({ color: event.target.value })} /></label>
        <label className="lxs-color-control" title="背景色"><span aria-hidden="true">▧</span><input aria-label="背景色" type="color" disabled={c.disabled} value={format?.background ?? "#ffffff"} onChange={event => formatSelection({ background: event.target.value })} /></label>
      </div>
      <div className="lxs-tool-group">
        <select aria-label="文字の配置" className="lxs-select" value={format?.align ?? "left"} disabled={c.disabled} onChange={event => formatSelection({ align: event.target.value as "left" | "center" | "right" })}>
          <option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option>
        </select>
        <select aria-label="数値の表示形式" className="lxs-select" value={format?.numberFormat ?? "general"} disabled={c.disabled} onChange={event => formatSelection({ numberFormat: event.target.value as "general" | "number" | "currency" | "percent" })}>
          <option value="general">標準</option><option value="number">数値</option><option value="currency">通貨</option><option value="percent">パーセント</option>
        </select>
      </div>
    </>}
    {c.features.rowColumnOperations && !c.readOnly && <div className="lxs-tool-group">
      <select aria-label="行と列の操作" className="lxs-select" value="" disabled={c.disabled} onChange={event => { if (event.target.value) structural(event.target.value); }}>
        <option value="" disabled>行・列</option><option value="insert-row">上に行を挿入</option><option value="insert-column">左に列を挿入</option><option value="delete-row">選択した行を削除</option><option value="delete-column">選択した列を削除</option>
      </select>
    </div>}
    <span className="lxs-ribbon-spacer" />
    {c.readOnly ? <span className="lxs-readonly">読み取り専用</span> : <button type="button" className="lxs-save" disabled={c.saving || (!c.dirty && !c.editing)} onClick={() => void c.save()}><Icon name="save" />{c.saving ? "保存中…" : "保存"}</button>}
  </div>;
}

export function SpreadsheetFormulaBar({ controller: c }: { controller: SpreadsheetController }) {
  const address = cellAddress(c.selection.focus.row, c.selection.focus.column);
  const [nameDraft, setNameDraft] = useState<{ address: string; value: string } | null>(null);
  const name = nameDraft?.address === address ? nameDraft.value : address;
  const setName = (value: string) => setNameDraft({ address, value });
  return <div className="lxs-formula-bar">
    <input aria-label="セルの位置" className="lxs-name-box" value={name} onChange={event => setName(event.target.value)} onBlur={() => setNameDraft(null)} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); setName(address); }
      if (event.key === "Enter") {
        event.preventDefault();
        try { const position = parseCellAddress(name.trim()); if (!position) throw new Error("A1のようなセル位置を入力してください"); if (position.row >= c.activeSheet.rowCount || position.column >= c.activeSheet.columnCount) throw new Error("シートの範囲外です"); if (c.commitEdit()) { c.select(position); c.requestGridFocus(); } }
        catch (cause) { c.reportError(cause); setName(address); }
      }
    }} />
    {c.features.formulas && <>
      <span className="lxs-formula-symbol" aria-hidden="true">ƒx</span>
      <input data-lxs-formula aria-label="セルの値・数式" className="lxs-formula-input" value={c.editing?.value ?? c.activeSheet.cells[address]?.value ?? ""} readOnly={c.disabled}
        onChange={event => c.beginEdit(c.selection.focus, event.target.value)} onBlur={() => c.commitEdit()}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); c.commitEdit(); }
          if (event.key === "Escape") { event.preventDefault(); c.cancelEdit(); }
        }} />
      {c.editing && <><Command label="入力を取り消す" onMouseDown={event => event.preventDefault()} onClick={c.cancelEdit}><Icon name="close" /></Command><Command label="入力を確定" onMouseDown={event => event.preventDefault()} onClick={c.commitEdit}><Icon name="check" /></Command></>}
    </>}
  </div>;
}
