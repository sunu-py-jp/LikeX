"use client";

import { cellAddress, deleteColumns, deleteRows, formatCells, insertColumns, insertRows, parseCellAddress } from "../model";
import { selectedAddresses, selectionBounds, type SpreadsheetController } from "../state/use-spreadsheet";
import { isMultiRangeSelection } from "../state/selection";
import type { useSpreadsheetClipboard } from "../state/use-spreadsheet-clipboard";
import { Command, Icon } from "./spreadsheet-controls";
import { useId, useRef, useState } from "react";
import { SpreadsheetInsertToolbar } from "./spreadsheet-insert-toolbar";
import { SpreadsheetFunctionPicker } from "./spreadsheet-function-picker";
import { SpreadsheetMergeToolbar } from "./spreadsheet-merge-toolbar";

type ToolbarProps = { controller: SpreadsheetController; clipboard: ReturnType<typeof useSpreadsheetClipboard> };

export function SpreadsheetToolbar({ controller: c, clipboard }: ToolbarProps) {
  const [tab, setTab] = useState<"home" | "insert">("home");
  const id = useId();
  const home = useRef<HTMLButtonElement>(null), insert = useRef<HTMLButtonElement>(null);
  const canInsert = !c.readOnly && (c.features.images || c.features.shapes || c.features.textBoxes || c.features.comments);
  const active = canInsert ? tab : "home";
  const changeTab = (next: "home" | "insert") => { setTab(next); (next === "home" ? home : insert).current?.focus(); };
  return <div className="lxs-ribbon-container">
    <div className="lxs-ribbon-header">
      <div className="lxs-ribbon-tabs" role="tablist" aria-label="リボンのタブ" onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || !canInsert) return;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          changeTab(event.key === "Home" ? "home" : event.key === "End" ? "insert" : active === "home" ? "insert" : "home");
        }
      }}>
        <button ref={home} type="button" role="tab" id={`${id}-home`} aria-controls={`${id}-home-panel`} aria-selected={active === "home"} tabIndex={active === "home" ? 0 : -1} className="lxs-ribbon-tab" onClick={() => setTab("home")}>ホーム</button>
        {canInsert && <button ref={insert} type="button" role="tab" id={`${id}-insert`} aria-controls={`${id}-insert-panel`} aria-selected={active === "insert"} tabIndex={active === "insert" ? 0 : -1} className="lxs-ribbon-tab" onClick={() => setTab("insert")}>挿入</button>}
      </div>
      {c.readOnly ? <span className="lxs-readonly">読み取り専用</span> : <button type="button" className="lxs-save" disabled={c.saving || (!c.dirty && !c.editing && !c.pendingObjectEdit)} onClick={() => void c.save()}><Icon name="save" />{c.saving ? "保存中…" : "保存"}</button>}
    </div>
    <div role="tabpanel" id={`${id}-home-panel`} aria-labelledby={`${id}-home`} hidden={active !== "home"}>
      <SpreadsheetHomeToolbar controller={c} clipboard={clipboard} />
    </div>
    {canInsert && <div role="tabpanel" id={`${id}-insert-panel`} aria-labelledby={`${id}-insert`} hidden={active !== "insert"}>
      <SpreadsheetInsertToolbar controller={c} />
    </div>}
  </div>;
}

function SpreadsheetHomeToolbar({ controller: c, clipboard }: ToolbarProps) {
  const cellDisabled = c.disabled || !!c.selectedDrawingId;
  const multiple = isMultiRangeSelection(c.selection);
  const singleRangeHint = multiple ? "1つの連続した範囲を選択してください" : undefined;
  const format = c.activeSheet.cells[cellAddress(c.selection.focus.row, c.selection.focus.column)]?.format;
  const formatSelection = (value: Parameters<typeof formatCells>[3]) => {
    if (cellDisabled || !c.commitEdit()) return;
    c.apply(wb => formatCells(wb, c.activeSheet.id, selectedAddresses(c.selection), value));
  };
  const structural = (action: string) => {
    if (cellDisabled) return;
    if (multiple) { c.reportError(new Error("行・列の挿入や削除は、1つの連続した範囲を選択してください")); return; }
    if (!c.commitEdit()) return;
    const { top, left, bottom, right } = selectionBounds(c.selection);
    c.apply(wb => action === "insert-row" ? insertRows(wb, c.activeSheet.id, top)
      : action === "insert-column" ? insertColumns(wb, c.activeSheet.id, left)
        : action === "delete-row" ? deleteRows(wb, c.activeSheet.id, top, bottom - top + 1)
          : deleteColumns(wb, c.activeSheet.id, left, right - left + 1));
  };
  return <div className="lxs-ribbon" role="toolbar" aria-label="シートの編集">
    {c.features.clipboard && <div className="lxs-tool-group">
      <Command label="コピー" title={singleRangeHint} disabled={!!c.selectedDrawingId || multiple} onClick={() => { if (!multiple && !c.selectedDrawingId && c.commitEdit()) void clipboard.copy(); }}><Icon name="copy" /></Command>
      {!c.readOnly && <><Command label="切り取り" title={singleRangeHint} disabled={cellDisabled || multiple} onClick={() => { if (!multiple && !cellDisabled && c.commitEdit()) void clipboard.copy(true); }}><Icon name="cut" /></Command>
        <Command label="貼り付け" title={singleRangeHint} disabled={cellDisabled || multiple} onClick={() => { if (!multiple && !cellDisabled && c.commitEdit()) void clipboard.paste(); }}><Icon name="paste" /></Command></>}
    </div>}
    {c.features.undoRedo && !c.readOnly && <div className="lxs-tool-group">
      <Command label="元に戻す" disabled={c.disabled || !c.canUndo} onClick={c.undo}><Icon name="undo" /></Command>
      <Command label="やり直す" disabled={c.disabled || !c.canRedo} onClick={c.redo}><Icon name="redo" /></Command>
    </div>}
    <SpreadsheetFunctionPicker controller={c} />
    {c.features.formatting && !c.readOnly && <>
      <div className="lxs-tool-group">
        <Command label="太字" aria-pressed={!!format?.bold} disabled={cellDisabled} onClick={() => formatSelection({ bold: !format?.bold })}><strong>B</strong></Command>
        <Command label="斜体" aria-pressed={!!format?.italic} disabled={cellDisabled} onClick={() => formatSelection({ italic: !format?.italic })}><i>I</i></Command>
        <Command label="下線" aria-pressed={!!format?.underline} disabled={cellDisabled} onClick={() => formatSelection({ underline: !format?.underline })}><u>U</u></Command>
        <label className="lxs-color-control" title="文字色"><span aria-hidden="true">A</span><input aria-label="文字色" type="color" disabled={cellDisabled} value={format?.color ?? "#202124"} onChange={event => formatSelection({ color: event.target.value })} /></label>
        <label className="lxs-color-control" title="背景色"><span aria-hidden="true">▧</span><input aria-label="背景色" type="color" disabled={cellDisabled} value={format?.background ?? "#ffffff"} onChange={event => formatSelection({ background: event.target.value })} /></label>
      </div>
      <div className="lxs-tool-group">
        <select aria-label="文字の配置" className="lxs-select" value={format?.align ?? "left"} disabled={cellDisabled} onChange={event => formatSelection({ align: event.target.value as "left" | "center" | "right" })}>
          <option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option>
        </select>
        <select aria-label="数値の表示形式" className="lxs-select" value={format?.numberFormat ?? "general"} disabled={cellDisabled} onChange={event => formatSelection({ numberFormat: event.target.value as "general" | "number" | "currency" | "percent" })}>
          <option value="general">標準</option><option value="number">数値</option><option value="currency">通貨</option><option value="percent">パーセント</option>
        </select>
      </div>
    </>}
    <SpreadsheetMergeToolbar controller={c} />
    {c.features.rowColumnOperations && !c.readOnly && <div className="lxs-tool-group">
      <select aria-label="行と列の操作" className="lxs-select" value="" title={singleRangeHint} disabled={cellDisabled || multiple} onChange={event => { if (event.target.value) structural(event.target.value); }}>
        <option value="" disabled>行・列</option><option value="insert-row">上に行を挿入</option><option value="insert-column">左に列を挿入</option><option value="delete-row">選択した行を削除</option><option value="delete-column">選択した列を削除</option>
      </select>
    </div>}
    {c.selectedDrawingId && <span className="lxs-ribbon-hint">描画を選択中</span>}
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
      <input data-lxs-formula aria-label="セルの値・数式" className="lxs-formula-input" value={c.editing?.value ?? c.activeSheet.cells[address]?.value ?? ""} readOnly={c.disabled || !!c.selectedDrawingId}
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
