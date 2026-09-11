"use client";

import { useEffect, useState } from "react";
import { cellAddress } from "../model/address";
import type { SpreadsheetCellFormat, SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetConditionalFormatRule } from "../model/conditional-formatting";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { rangeBounds, selectedAddresses, selectionRanges } from "../state/selection";
import { autoFitCommand } from "../state/sizing/auto-fit-command";
import type { SpreadsheetSelection } from "../props";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { Command } from "./spreadsheet-controls";

export function SpreadsheetFormatToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const [dialog, setDialog] = useState<"format" | "conditional" | null>(null);
  const disabled = c.disabled || c.requesting || !!c.selectedDrawingId;
  const closeDialog = () => { c.cancelEditRequest(); setDialog(null); };
  const format = c.activeSheet.cells[cellAddress(c.selection.focus.row, c.selection.focus.column)]?.format;
  const patch = (format: SpreadsheetCellFormat) => {
    if (disabled) return;
    try { const addresses = selectedAddresses(c.selection); c.afterCommit(() => c.afterCommand({ type: "cells.format", sheetId: c.activeSheet.id, addresses, format })); }
    catch (cause) { c.reportError(cause); }
  };
  const fit = (axis: "row" | "column", ownerDocument: Document) => {
    if (disabled) return;
    c.afterCommit(() => {
      const indices = new Set<number>();
      for (const selection of selectionRanges(c.selection)) { const bounds = rangeBounds(selection); for (let index = axis === "row" ? bounds.top : bounds.left; index <= (axis === "row" ? bounds.bottom : bounds.right); index++) indices.add(index); }
      const workbook = c.getWorkbook();
      c.afterCommand(autoFitCommand(workbook, c.activeSheet.id, axis, indices, ownerDocument, workbook === c.workbook ? c.calculated[c.activeSheet.id] : undefined));
    });
  };
  if (c.readOnly) return null;
  return <>
    {c.features.formatting && <div className="lxs-tool-group lxs-format-controls">
      <Command label="太字" aria-pressed={!!format?.bold} disabled={disabled} onClick={() => patch({ bold: !format?.bold })}><strong>B</strong></Command>
      <Command label="斜体" aria-pressed={!!format?.italic} disabled={disabled} onClick={() => patch({ italic: !format?.italic })}><i>I</i></Command>
      <Command label="下線" aria-pressed={!!format?.underline} disabled={disabled} onClick={() => patch({ underline: !format?.underline })}><u>U</u></Command>
      <label className="lxs-color-control" title="文字色"><span aria-hidden="true">A</span><input aria-label="文字色" type="color" disabled={disabled} value={/^#[\da-f]{6}$/i.test(format?.color ?? "") ? format!.color : "#202124"} onChange={event => patch({ color: event.currentTarget.value })} /></label>
      <label className="lxs-color-control" title="背景色"><span aria-hidden="true">▧</span><input aria-label="背景色" type="color" disabled={disabled} value={/^#[\da-f]{6}$/i.test(format?.background ?? "") ? format!.background : "#ffffff"} onChange={event => patch({ background: event.currentTarget.value })} /></label>
      <select className="lxs-select" aria-label="文字の配置" value={format?.align ?? "left"} disabled={disabled} onChange={event => patch({ align: event.currentTarget.value as "left" | "center" | "right" })}><option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option></select>
      <select className="lxs-select" aria-label="数値の表示形式" value={format?.numberFormat ?? "general"} disabled={disabled} onChange={event => patch({ numberFormat: event.currentTarget.value as SpreadsheetCellFormat["numberFormat"] })}>{[["general", "標準"], ["number", "数値"], ["currency", "通貨"], ["percent", "パーセント"], ["date", "日付"], ["time", "時刻"], ["datetime", "日時"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className="lxs-select" aria-label="フォント" disabled={disabled} value={format?.fontFamily ?? ""} onChange={event => patch({ fontFamily: event.currentTarget.value })}>
        <option value="" disabled>標準フォント</option>{["Arial", "Calibri", "Yu Gothic", "Meiryo", "Noto Sans JP", "Times New Roman", "Courier New"].map(font => <option key={font}>{font}</option>)}
        {format?.fontFamily && !["Arial", "Calibri", "Yu Gothic", "Meiryo", "Noto Sans JP", "Times New Roman", "Courier New"].includes(format.fontFamily) && <option>{format.fontFamily}</option>}
      </select>
      <select className="lxs-select lxs-format-size" aria-label="フォントサイズ（px）" disabled={disabled} value={format?.fontSize ?? 13} onChange={event => patch({ fontSize: Number(event.currentTarget.value) })}>
        {[...new Set([10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 48, 72, format?.fontSize ?? 13])].sort((a, b) => a - b).map(size => <option key={size}>{size}</option>)}
      </select>
      <Command label="折り返して全体を表示" disabled={disabled} aria-pressed={!!format?.wrap} onClick={() => patch({ wrap: !format?.wrap })}>折返し</Command>
      <select className="lxs-select" aria-label="縦方向の配置" disabled={disabled} value={format?.verticalAlign ?? "middle"} onChange={event => patch({ verticalAlign: event.currentTarget.value as "top" | "middle" | "bottom" })}>
        <option value="top">上揃え</option><option value="middle">上下中央</option><option value="bottom">下揃え</option>
      </select>
      <Command label="罫線と数値の書式" disabled={disabled} onClick={() => c.afterCommit(() => setDialog("format"))}>書式…</Command>
      {c.features.conditionalFormatting && <Command label="条件付き書式" disabled={disabled} onClick={() => c.afterCommit(() => setDialog("conditional"))}>条件付き書式…</Command>}
    </div>}
    {c.features.resize && <div className="lxs-tool-group"><select className="lxs-select" aria-label="行列サイズの自動調整" disabled={disabled} value="" onChange={event => { const value = event.currentTarget.value, doc = event.currentTarget.ownerDocument; if (value) fit(value as "row" | "column", doc); }}>
      <option value="" disabled>サイズ調整</option><option value="row">行の高さを自動調整</option><option value="column">列の幅を自動調整</option>
    </select></div>}
    {dialog === "format" && c.features.formatting && <CellFormatDialog controller={c} onClose={closeDialog} />}
    {dialog === "conditional" && c.features.formatting && c.features.conditionalFormatting && <ConditionalFormatDialog controller={c} onClose={closeDialog} />}
  </>;
}
export function CellFormatDialog({ controller: c, onClose, target }: { controller: SpreadsheetController; onClose: () => void;
  target?: {sheetId: string; selection: SpreadsheetSelection} }) {
  const [snapshot] = useState(() => ({ workbook: c.getWorkbook(), sheetId: target?.sheetId ?? c.activeSheet.id, selection: target?.selection ?? c.selection }));
  const stale = c.workbook !== snapshot.workbook;
  const { cancelEditRequest } = c;
  useEffect(() => cancelEditRequest, [cancelEditRequest]);
  const initial = snapshot.workbook.sheets.find(sheet => sheet.id === snapshot.sheetId)?.cells[cellAddress(snapshot.selection.focus.row, snapshot.selection.focus.column)]?.format;
  const [format, setFormat] = useState<SpreadsheetCellFormat>({ numberFormat: initial?.numberFormat ?? "number", decimalPlaces: initial?.decimalPlaces ?? 2, useGrouping: initial?.useGrouping ?? true, negativeFormat: initial?.negativeFormat ?? "minus" });
  const [borderEnabled, setBorderEnabled] = useState(false), [edges, setEdges] = useState<string[]>(["top", "right", "bottom", "left"]);
  const [color, setColor] = useState("#808080"), [width, setWidth] = useState<1 | 2 | 3>(1), [style, setStyle] = useState<"solid" | "dashed" | "dotted" | "double" | "none">("solid");
  const disabled = c.disabled || c.requesting || stale;
  const apply = () => {
    if (disabled || c.getWorkbook() !== snapshot.workbook) return;
    try { const addresses = selectedAddresses(snapshot.selection);
      const patch: SpreadsheetCellFormat = borderEnabled ? { borders: Object.fromEntries(edges.map(edge => [edge, { color, width, style }])) } : format;
      void Promise.resolve(c.executeCommands([{ type: "cells.format", sheetId: snapshot.sheetId, addresses, format: patch }],
        {isCurrent: () => c.getWorkbook() === snapshot.workbook})).then(result => { if (result.ok) onClose(); }, c.reportError);
    } catch (cause) { c.reportError(cause); }
  };
  return <SpreadsheetDialog title="セルの書式" onClose={onClose} actions={<><button type="button" onClick={onClose}>キャンセル</button><button type="button" disabled={disabled} onClick={apply}>適用</button></>}>
    {stale && <p role="alert">データが変更されました。閉じて選択し直してください。</p>}
    <div className="lxs-format-dialog-fields">
      <label className="lxs-field-full">設定する書式<select disabled={disabled} value={borderEnabled ? "border" : "number"} onChange={event => setBorderEnabled(event.currentTarget.value === "border")}><option value="number">数値・日付・時刻</option><option value="border">罫線</option></select></label>
      {!borderEnabled ? <>
        <label>表示形式<select disabled={disabled} value={format.numberFormat} onChange={event => setFormat({ ...format, numberFormat: event.currentTarget.value as SpreadsheetCellFormat["numberFormat"] })}>{[["general", "標準"], ["number", "数値"], ["currency", "通貨"], ["percent", "パーセント"], ["date", "日付"], ["time", "時刻"], ["datetime", "日時"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>小数点以下の桁数<input disabled={disabled} type="number" min="0" max="10" value={format.decimalPlaces} onChange={event => setFormat({ ...format, decimalPlaces: Number(event.currentTarget.value) })} /></label>
        <label>桁区切り<select disabled={disabled} value={format.useGrouping ? "yes" : "no"} onChange={event => setFormat({ ...format, useGrouping: event.currentTarget.value === "yes" })}><option value="yes">あり（1,000）</option><option value="no">なし（1000）</option></select></label>
        <label>負数<select disabled={disabled} value={format.negativeFormat} onChange={event => setFormat({ ...format, negativeFormat: event.currentTarget.value as SpreadsheetCellFormat["negativeFormat"] })}><option value="minus">-123</option><option value="parentheses">(123)</option><option value="red">赤 -123</option><option value="red-parentheses">赤 (123)</option></select></label>
      </> : <>
        <label>線の色<input disabled={disabled} type="color" value={color} onChange={event => setColor(event.currentTarget.value)} /></label>
        <label>線の太さ<select disabled={disabled} value={width} onChange={event => setWidth(Number(event.currentTarget.value) as 1 | 2 | 3)}><option value="1">細い</option><option value="2">中</option><option value="3">太い</option></select></label>
        <label>線の種類<select disabled={disabled} value={style} onChange={event => setStyle(event.currentTarget.value as typeof style)}><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option><option value="double">二重線</option><option value="none">罫線なし</option></select></label>
        <fieldset><legend>各セルに適用する辺</legend>{[["top", "上"], ["right", "右"], ["bottom", "下"], ["left", "左"]].map(([value, label]) => <label key={value}><span><input disabled={disabled} type="checkbox" checked={edges.includes(value)} onChange={event => setEdges(event.currentTarget.checked ? [...edges, value] : edges.filter(edge => edge !== value))} />{label}</span></label>)}</fieldset>
      </>}
    </div>
  </SpreadsheetDialog>;
}
function ConditionalFormatDialog({ controller: c, onClose }: { controller: SpreadsheetController; onClose: () => void }) {
  const [initial, setInitial] = useState(() => ({ workbook: c.getWorkbook(), sheetId: c.activeSheet.id, ranges: selectionRanges(c.selection).map(rangeBounds) as SpreadsheetMergedRange[] }));
  const { cancelEditRequest } = c;
  useEffect(() => cancelEditRequest, [cancelEditRequest]);
  const stale = c.workbook !== initial.workbook;
  const [kind, setKind] = useState<SpreadsheetConditionalFormatRule["type"]>("comparison"), [operator, setOperator] = useState("gt"), [value, setValue] = useState("0"), [second, setSecond] = useState("100");
  const [color, setColor] = useState("#fecaca"), [maxColor, setMaxColor] = useState("#86efac"), [middle, setMiddle] = useState(false);
  const sheet = c.workbook.sheets.find(sheet => sheet.id === initial.sheetId), disabled = c.disabled || c.requesting || !sheet || stale;
  const existing = sheet?.conditionalFormats ?? [];
  const setRules = (rules: readonly SpreadsheetConditionalFormatRule[], close = false) => {
    if (!disabled && c.getWorkbook() === initial.workbook) c.afterCommand({ type: "conditionalFormats.set", sheetId: initial.sheetId, rules }, () => {
      setInitial({ ...initial, workbook: c.getWorkbook() }); if (close) onClose();
    });
  };
  const apply = () => {
    const id = `cf-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    const base = { id, ranges: initial.ranges };
    const rule: SpreadsheetConditionalFormatRule = kind === "comparison" ? { ...base, type: kind, operator: operator as "gt", value: Number(value), ...(["between", "notBetween"].includes(operator) ? { secondValue: Number(second) } : {}), format: { background: color } }
      : kind === "text" ? { ...base, type: kind, operator: operator as "contains", value, format: { background: color } }
        : kind === "dataBar" ? { ...base, type: kind, color }
          : { ...base, type: kind, colors: middle ? [color, "#ffeb84", maxColor] : [color, maxColor] };
    setRules([...existing, rule], true);
  };
  const choices = kind === "comparison" ? [["gt", "より大きい"], ["gte", "以上"], ["lt", "より小さい"], ["lte", "以下"], ["eq", "等しい"], ["neq", "等しくない"], ["between", "範囲内"], ["notBetween", "範囲外"]] : [["contains", "含む"], ["notContains", "含まない"], ["startsWith", "で始まる"], ["endsWith", "で終わる"]];
  return <SpreadsheetDialog title="条件付き書式" onClose={onClose} actions={<><button type="button" onClick={onClose}>キャンセル</button><button type="button" disabled={disabled} onClick={apply}>ルールを追加</button></>}>
    {stale && <p role="alert">データが変更されました。閉じて選択し直してください。</p>}
    <p>選択範囲に適用します。上のルールを優先します。</p>
    <div className="lxs-format-dialog-fields">
      <label>ルールの種類<select value={kind} onChange={event => { const next = event.currentTarget.value as typeof kind; setKind(next); setOperator(next === "text" ? "contains" : "gt"); }}><option value="comparison">数値の比較</option><option value="text">文字列の比較</option><option value="dataBar">データバー</option><option value="colorScale">カラースケール</option></select></label>
      {(kind === "comparison" || kind === "text") && <><label>条件<select value={operator} onChange={event => setOperator(event.currentTarget.value)}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>比較する値<input type={kind === "comparison" ? "number" : "text"} value={value} onChange={event => setValue(event.currentTarget.value)} /></label>{["between", "notBetween"].includes(operator) && <label>上限<input type="number" value={second} onChange={event => setSecond(event.currentTarget.value)} /></label>}</>}
      <label>{kind === "colorScale" ? "最小値の色" : kind === "dataBar" ? "バーの色" : "背景色"}<input type="color" value={color} onChange={event => setColor(event.currentTarget.value)} /></label>
      {kind === "colorScale" && <><label>最大値の色<input type="color" value={maxColor} onChange={event => setMaxColor(event.currentTarget.value)} /></label><label>色の数<select value={middle ? "3" : "2"} onChange={event => setMiddle(event.currentTarget.value === "3")}><option value="2">2色</option><option value="3">3色（中間は黄色）</option></select></label></>}
    </div>
    {!!existing.length && <ul className="lxs-cf-list" aria-label="設定済みの条件付き書式">{existing.map((rule, index) => <li key={rule.id}><span>{index + 1}. {rule.type === "comparison" ? "数値の比較" : rule.type === "text" ? "文字列の比較" : rule.type === "dataBar" ? "データバー" : "カラースケール"}</span><button type="button" disabled={disabled} aria-label={`ルール${index + 1}を削除`} onClick={() => setRules(existing.filter(item => item.id !== rule.id))}>削除</button></li>)}</ul>}
  </SpreadsheetDialog>;
}
