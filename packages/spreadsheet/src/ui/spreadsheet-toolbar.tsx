"use client";

import { cellAddress, parseCellAddress } from "../model";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { selectionBounds } from "../state/selection";
import { isMultiRangeSelection } from "../state/selection";
import type { useSpreadsheetClipboard } from "../state/use-spreadsheet-clipboard";
import { Command, Icon } from "./spreadsheet-controls";
import { useId, useRef, useState } from "react";
import { SpreadsheetInsertToolbar } from "./spreadsheet-insert-toolbar";
import { SpreadsheetFunctionPicker } from "./spreadsheet-function-picker";
import { SpreadsheetPersistenceControls } from "./spreadsheet-persistence-controls";
import { SpreadsheetAutoFitControl, SpreadsheetFormatToolbar } from "./spreadsheet-format-toolbar";
import { SpreadsheetEditToolbar, SpreadsheetPasteSpecialControl } from "./spreadsheet-edit-toolbar";
import { SpreadsheetDataToolbar } from "./spreadsheet-data-toolbar";
import { SpreadsheetNamedRanges } from "./spreadsheet-named-ranges";
import { SpreadsheetClearMenu } from "./spreadsheet-clear-menu";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import { HorizontalScrollStrip } from "./horizontal-scroll-strip";

type ToolbarProps = { controller: SpreadsheetController; clipboard: ReturnType<typeof useSpreadsheetClipboard> };

export function SpreadsheetToolbar({ controller: c, clipboard }: ToolbarProps) {
  type Tab = "home" | "insert" | "data";
  const [tab, setTab] = useState<Tab>("home");
  const id = useId();
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const canInsert = !c.readOnly && (c.features.images || c.features.shapes || c.features.textBoxes || c.features.comments || c.features.tables && c.features.formatting);
  const canData = !c.readOnly && (c.features.dataValidation || c.features.namedRanges);
  const tabs: { key: Tab; label: string }[] = [{ key: "home", label: "ホーム" },
    ...(canInsert ? [{ key: "insert" as const, label: "挿入" }] : []), ...(canData ? [{ key: "data" as const, label: "データ" }] : [])];
  const active = tabs.some(item => item.key === tab) ? tab : "home";
  const changeTab = (next: Tab) => { setTab(next); refs.current[next]?.focus(); };
  return <div className="lxs-ribbon-container">
    <div className="lxs-ribbon-header">
      <div className="lxs-ribbon-tabs" role="tablist" aria-label="リボンのタブ" onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const current = tabs.findIndex(item => item.key === active);
          const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
            : (current + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
          changeTab(tabs[index].key);
        }
      }}>
        {tabs.map(item => <button key={item.key} ref={element => { refs.current[item.key] = element; }} type="button" role="tab"
          id={`${id}-${item.key}`} aria-controls={`${id}-${item.key}-panel`} aria-selected={active === item.key}
          tabIndex={active === item.key ? 0 : -1} className="lxs-ribbon-tab" onClick={() => setTab(item.key)}>{item.label}</button>)}
      </div>
      {c.features.undoRedo && !c.readOnly && <div className="lxs-ribbon-quick-access" role="group" aria-label="操作履歴">
        <Command label="元に戻す" disabled={c.disabled || !c.canUndo} onClick={c.undo}><Icon name="undo" /></Command>
        <Command label="やり直す" disabled={c.disabled || !c.canRedo} onClick={c.redo}><Icon name="redo" /></Command>
      </div>}
      <SpreadsheetPersistenceControls controller={c} />
    </div>
    <div role="tabpanel" id={`${id}-home-panel`} aria-labelledby={`${id}-home`} hidden={active !== "home"}>
      <SpreadsheetHomeToolbar controller={c} clipboard={clipboard} />
    </div>
    {canInsert && <div role="tabpanel" id={`${id}-insert-panel`} aria-labelledby={`${id}-insert`} hidden={active !== "insert"}>
      <SpreadsheetInsertToolbar controller={c} />
    </div>}
    {canData && <div role="tabpanel" id={`${id}-data-panel`} aria-labelledby={`${id}-data`} hidden={active !== "data"}>
      <HorizontalScrollStrip className="lxs-ribbon" role="toolbar" aria-label="データの操作" itemSelector=".lxs-ribbon-group" previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示"><SpreadsheetNamedRanges controller={c} /><SpreadsheetDataToolbar controller={c} /></HorizontalScrollStrip>
    </div>}
  </div>;
}

function SpreadsheetHomeToolbar({ controller: c, clipboard }: ToolbarProps) {
  const cellDisabled = c.disabled || c.requesting || !!c.selectedDrawingId;
  const multiple = isMultiRangeSelection(c.selection);
  const drawingSelected = !!c.selectedDrawingId;
  const clipboardDisabled = c.disabled || c.requesting || c.pendingObjectEdit || (!drawingSelected && multiple);
  const singleRangeHint = multiple ? "1つの連続した範囲を選択してください" : undefined;
  const structural = (action: string) => {
    if (cellDisabled) return;
    if (multiple) { c.reportError(new Error("行・列の挿入や削除は、1つの連続した範囲を選択してください")); return; }
    const { top, left, bottom, right } = selectionBounds(c.selection);
    const sheetId = c.activeSheet.id;
    c.afterCommit(() => c.afterCommand(action === "insert-row" ? { type: "rows.insert", sheetId, index: top }
      : action === "insert-column" ? { type: "columns.insert", sheetId, index: left }
        : action === "delete-row" ? { type: "rows.delete", sheetId, index: top, count: bottom - top + 1 }
          : { type: "columns.delete", sheetId, index: left, count: right - left + 1 }));
  };
  return <HorizontalScrollStrip className="lxs-ribbon" role="toolbar" aria-label="シートの編集" itemSelector=".lxs-ribbon-group" previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示">
    {(c.features.copy || (!c.readOnly && (c.features.cut || c.features.paste || c.features.pasteSpecial))) && <RibbonGroup label="クリップボード" className="lxs-ribbon-group-clipboard">
      <div className="lxs-ribbon-columns">
        {!c.readOnly && c.features.paste && <Command label="貼り付け" className="lxs-ribbon-command-large" title={singleRangeHint} disabled={clipboardDisabled}
          onClick={() => { if (!clipboardDisabled) c.afterCommit(() => void clipboard.paste()); }}><Icon name="paste" /><span>貼り付け</span></Command>}
        {(c.features.copy || !c.readOnly && (c.features.cut || c.features.pasteSpecial)) && <div className="lxs-ribbon-stack">
          {(c.features.copy || !c.readOnly && c.features.cut) && <div className="lxs-ribbon-row">
            {!c.readOnly && c.features.cut && <Command label="切り取り" title={singleRangeHint} disabled={cellDisabled || multiple} onClick={() => { if (!multiple && !cellDisabled) c.afterCommit(() => void clipboard.copy(true)); }}><Icon name="cut" /></Command>}
            {c.features.copy && <Command label="コピー" title={singleRangeHint} disabled={c.pendingObjectEdit || (!drawingSelected && multiple)} onClick={() => { if (drawingSelected || !multiple) c.afterCommit(() => void clipboard.copy()); }}><Icon name="copy" /></Command>}
          </div>}
          <SpreadsheetPasteSpecialControl controller={c} clipboard={clipboard} />
        </div>}
      </div>
    </RibbonGroup>}
    <SpreadsheetFormatToolbar controller={c} />
    {(c.features.insertRows || c.features.deleteRows || c.features.insertColumns || c.features.deleteColumns || c.features.resize) && !c.readOnly && <RibbonGroup label="セル" className="lxs-ribbon-group-cells">
      <div className="lxs-ribbon-stack">
        {(c.features.insertRows || c.features.deleteRows || c.features.insertColumns || c.features.deleteColumns) && <select aria-label="行と列の操作" className="lxs-select" value="" title={singleRangeHint} disabled={cellDisabled || multiple} onChange={event => { if (event.target.value) structural(event.target.value); }}>
          <option value="" disabled>行・列の操作</option>{c.features.insertRows && <option value="insert-row">上に行を挿入</option>}{c.features.insertColumns && <option value="insert-column">左に列を挿入</option>}{c.features.deleteRows && <option value="delete-row">選択した行を削除</option>}{c.features.deleteColumns && <option value="delete-column">選択した列を削除</option>}
        </select>}
        <SpreadsheetAutoFitControl controller={c} />
      </div>
    </RibbonGroup>}
    {(c.features.search || !c.readOnly) && <RibbonGroup label="編集" className="lxs-ribbon-group-editing">
      <div className="lxs-ribbon-columns">
        <SpreadsheetEditToolbar controller={c} />
        {!c.readOnly && <div className="lxs-ribbon-stack"><SpreadsheetFunctionPicker controller={c} /><SpreadsheetClearMenu controller={c} /></div>}
      </div>
    </RibbonGroup>}
    {c.selectedDrawingId && <span className="lxs-ribbon-hint">描画を選択中</span>}
  </HorizontalScrollStrip>;
}

export function SpreadsheetFormulaBar({ controller: c }: { controller: SpreadsheetController }) {
  const address = cellAddress(c.selection.focus.row, c.selection.focus.column);
  const bounds = selectionBounds(c.selection);
  const named = c.features.namedRanges && !isMultiRangeSelection(c.selection) ? c.workbook.namedRanges?.find(item => item.sheetId === c.activeSheet.id &&
    item.range.top === bounds.top && item.range.left === bounds.left && item.range.bottom === bounds.bottom && item.range.right === bounds.right) : undefined;
  const [nameDraft, setNameDraft] = useState<{ address: string; value: string } | null>(null);
  const name = nameDraft?.address === address ? nameDraft.value : named?.name ?? address;
  const setName = (value: string) => setNameDraft({ address, value });
  return <div className="lxs-formula-bar">
    <input aria-label="セルの位置" title={c.features.namedRanges ? "A1形式の番地、または名前付き範囲" : undefined} className="lxs-name-box" value={name} onChange={event => setName(event.target.value)} onBlur={() => setNameDraft(null)} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); setName(address); }
      if (event.key === "Enter") {
        event.preventDefault();
        try {
          const definition = c.features.namedRanges ? c.getWorkbook().namedRanges?.find(item => item.name.toLocaleLowerCase("en-US") === name.trim().toLocaleLowerCase("en-US")) : undefined;
          if (definition) {
            c.afterCommit(() => {
              const current = c.getWorkbook().namedRanges?.find(item => item.id === definition.id);
              if (!current || !c.selectRangeInSheet(current.sheetId, { row: current.range.top, column: current.range.left }, { row: current.range.bottom, column: current.range.right })) {
                c.reportError(new Error("この名前付き範囲へ移動できません")); return;
              }
              setNameDraft(null); c.requestGridFocus();
            });
            return;
          }
          const position = parseCellAddress(name.trim());
          if (!position) throw new Error(c.features.namedRanges ? "A1のようなセル位置か、登録済みの範囲名を入力してください" : "A1のようなセル位置を入力してください");
          if (position.row >= c.activeSheet.rowCount || position.column >= c.activeSheet.columnCount) throw new Error("シートの範囲外です");
          c.afterCommit(() => { c.select(position); c.requestGridFocus(); });
        }
        catch (cause) { c.reportError(cause); setName(address); }
      }
    }} />
    {c.features.formulas && <>
      <span className="lxs-formula-symbol" aria-hidden="true">ƒx</span>
      <input data-lxs-formula aria-label="セルの値・数式" className="lxs-formula-input" value={c.editing?.value ?? c.activeSheet.cells[address]?.value ?? ""} readOnly={c.disabled || c.requesting || !!c.selectedDrawingId}
        onChange={event => c.beginEdit(c.selection.focus, event.target.value)} onBlur={() => c.commitEdit()}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); c.commitEdit(); }
          if (event.key === "Escape") { event.preventDefault(); c.cancelEdit(); }
        }} />
      {c.editing && <><Command label="入力を取り消す" disabled={c.disabled || c.requesting} onMouseDown={event => event.preventDefault()} onClick={c.cancelEdit}><Icon name="close" /></Command><Command label="入力を確定" disabled={c.disabled || c.requesting} onMouseDown={event => event.preventDefault()} onClick={() => void c.commitEdit()}><Icon name="check" /></Command></>}
    </>}
  </div>;
}
