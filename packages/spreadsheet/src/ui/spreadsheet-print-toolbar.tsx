"use client";

import { useState } from "react";
import { cellAddress, parseCellAddress } from "../model";
import type { SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { isMultiRangeSelection, selectionBounds } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import { HorizontalScrollStrip } from "./horizontal-scroll-strip";
import { usePrintCommand } from "./use-print-command";

export const printAreaAddress = (range: SpreadsheetMergedRange | undefined) => range
  ? `${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}` : "";

/** Explicit A1 entry provides a keyboard-accessible alternative to dragging the blue boundary. */
export function parsePrintAreaAddress(value: string): SpreadsheetMergedRange | null {
  const match = /^\s*(\$?[A-Za-z]+\$?[1-9]\d*)\s*(?::\s*(\$?[A-Za-z]+\$?[1-9]\d*))?\s*$/.exec(value);
  if (!match) return null;
  const start = parseCellAddress(match[1].replaceAll("$", "").toUpperCase());
  const end = parseCellAddress((match[2] ?? match[1]).replaceAll("$", "").toUpperCase());
  return start && end ? { top: Math.min(start.row, end.row), left: Math.min(start.column, end.column),
    bottom: Math.max(start.row, end.row), right: Math.max(start.column, end.column) } : null;
}

function PrintRangeInput({ controller: c, disabled }: { controller: SpreadsheetController; disabled: boolean }) {
  const [value, setValue] = useState(printAreaAddress(c.activeSheet.printSettings?.area));
  const [invalid, setInvalid] = useState(false);
  const run = usePrintCommand(c);
  const apply = () => {
    const range = parsePrintAreaAddress(value);
    if (!range || range.bottom >= c.activeSheet.rowCount || range.right >= c.activeSheet.columnCount) {
      setInvalid(true); c.reportError(new Error("印刷範囲にはシート内のセル範囲を指定してください（例: A1:H40）")); return;
    }
    setInvalid(false); run({ type: "print.setArea", sheetId: c.activeSheet.id, range }, () => c.setPrintAreaView(true));
  };
  return <form className="lxs-print-range-form" onSubmit={event => { event.preventDefault(); if (!disabled) apply(); }}>
    <label>印刷範囲<input aria-label="印刷範囲のセル参照" value={value} placeholder="A1:H40" disabled={disabled} aria-invalid={invalid}
      onChange={event => { setValue(event.currentTarget.value); setInvalid(false); }} /></label>
    <Command label="印刷範囲を変更" disabled={disabled} onClick={apply}><Icon name="check" /><span>変更</span></Command>
  </form>;
}

export function SpreadsheetPrintToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const settings = c.activeSheet.printSettings, area = settings?.area;
  const disabled = c.disabled || c.requesting || c.pendingObjectEdit || !c.features.printArea;
  const sheetId = c.activeSheet.id, focus = c.selection.focus;
  const apply = usePrintCommand(c);
  const rowBreaks = settings?.rowBreaks ?? [], columnBreaks = settings?.columnBreaks ?? [];
  const hasRowBreak = rowBreaks.includes(focus.row), hasColumnBreak = columnBreaks.includes(focus.column);
  const rowInside = !!area && focus.row > area.top && focus.row <= area.bottom;
  const columnInside = !!area && focus.column > area.left && focus.column <= area.right;
  if (!c.features.printArea) return <HorizontalScrollStrip className="lxs-ribbon lxs-print-toolbar" role="toolbar" aria-label="ページ レイアウトの操作"
    itemSelector=".lxs-ribbon-group" previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示">
    <RibbonGroup label="表示"><Command label="印刷範囲を表示" aria-pressed={c.printAreaView} onClick={() => c.setPrintAreaView(!c.printAreaView)}>
      <Icon name="table" /><span>改ページ表示</span></Command></RibbonGroup>
  </HorizontalScrollStrip>;
  return <HorizontalScrollStrip className="lxs-ribbon lxs-print-toolbar" role="toolbar" aria-label="ページ レイアウトの操作"
    itemSelector=".lxs-ribbon-group" previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示">
    <RibbonGroup label="印刷範囲"><div className="lxs-ribbon-columns">
      <Command label="選択範囲を印刷範囲に設定" disabled={disabled || !!c.selectedDrawingId || isMultiRangeSelection(c.selection)}
        onClick={() => apply({ type: "print.setArea", sheetId, range: selectionBounds(c.selection) }, () => c.setPrintAreaView(true))}>
        <Icon name="borders" /><span>選択範囲を設定</span></Command>
      <Command label="印刷範囲を解除" disabled={disabled || !area} onClick={() => apply({ type: "print.clearArea", sheetId })}><Icon name="close" /><span>解除</span></Command>
      <Command label="印刷範囲を表示" aria-pressed={c.printAreaView} onClick={() => c.setPrintAreaView(!c.printAreaView)}><Icon name="table" /><span>改ページ表示</span></Command>
    </div><PrintRangeInput key={`${sheetId}:${printAreaAddress(area)}`} controller={c} disabled={disabled} /></RibbonGroup>
    <RibbonGroup label="ページ設定"><div className="lxs-print-layout-fields">
      <label>用紙<select aria-label="印刷の用紙サイズ" disabled={disabled} value={settings?.paperSize ?? "A4"}
        onChange={event => apply({ type: "print.setLayout", sheetId, paperSize: event.currentTarget.value as "A4" | "A3" | "Letter" })}>
        <option value="A4">A4</option><option value="A3">A3</option><option value="Letter">Letter</option></select></label>
      <label>向き<select aria-label="印刷の向き" disabled={disabled} value={settings?.orientation ?? "portrait"}
        onChange={event => apply({ type: "print.setLayout", sheetId, orientation: event.currentTarget.value as "portrait" | "landscape" })}>
        <option value="portrait">縦</option><option value="landscape">横</option></select></label>
      <label>拡大縮小<input key={`${sheetId}:${settings?.scale}`} aria-label="印刷の拡大縮小率" type="number" min="10" max="400" step="1" disabled={disabled} defaultValue={settings?.scale ?? 100}
        onBlur={event => { const scale = Number(event.currentTarget.value); if (scale !== (settings?.scale ?? 100)) apply({ type: "print.setLayout", sheetId, scale }); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /><span>%</span></label>
    </div></RibbonGroup>
    <RibbonGroup label="手動改ページ"><div className="lxs-print-break-controls">
      <Command label={hasRowBreak ? "選択行の前の改ページを解除" : "選択行の前で改ページ"} disabled={disabled || !rowInside}
        onClick={() => apply({ type: "print.setBreaks", sheetId, rows: hasRowBreak ? rowBreaks.filter(row => row !== focus.row) : [...rowBreaks, focus.row] })}>
        <span>{hasRowBreak ? "行の改ページを解除" : "行の前で改ページ"}</span></Command>
      <Command label={hasColumnBreak ? "選択列の前の改ページを解除" : "選択列の前で改ページ"} disabled={disabled || !columnInside}
        onClick={() => apply({ type: "print.setBreaks", sheetId, columns: hasColumnBreak ? columnBreaks.filter(column => column !== focus.column) : [...columnBreaks, focus.column] })}>
        <span>{hasColumnBreak ? "列の改ページを解除" : "列の前で改ページ"}</span></Command>
      <Command label="手動改ページをすべて解除" disabled={disabled || !rowBreaks.length && !columnBreaks.length}
        onClick={() => apply({ type: "print.setBreaks", sheetId, rows: [], columns: [] })}><span>すべて解除</span></Command>
    </div></RibbonGroup>
  </HorizontalScrollStrip>;
}
