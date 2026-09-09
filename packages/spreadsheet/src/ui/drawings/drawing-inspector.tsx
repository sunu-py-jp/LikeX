"use client";

import { useRef, useState } from "react";
import { chainResult, type MaybePromise } from "../../core";
import { cellAddress, type SpreadsheetDrawing, type SpreadsheetDrawingPatch } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";
import { Command, Icon } from "../spreadsheet-controls";
import { drawingLabel, visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

function PropertyField({ label, value, onCommit, controller: c, type = "text" }: { label: string; value: string | number; onCommit: (value: string) => MaybePromise<boolean>; controller: SpreadsheetController; type?: "text" | "number" }) {
  const [draft, setDraft] = useState<string | null>(null);
  const generation = useRef(0);
  const markPending = useObjectEditPending(c);
  const base = String(value), text = draft ?? base;
  const commit = () => {
    const version = generation.current;
    return chainResult(text === base || (!c.disabled && onCommit(text)), accepted => {
      if (accepted && generation.current === version) { setDraft(null); markPending(false); }
      return accepted;
    });
  };
  return <label className="lxs-object-property"><span>{label}</span><input type={type} value={text} disabled={c.disabled || c.requesting} aria-label={label} onChange={event => { generation.current++; setDraft(event.target.value); markPending(event.target.value !== base); }} onBlur={commit} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); generation.current++; c.cancelEditRequest(); setDraft(null); markPending(false); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void chainResult(commit(), accepted => { if (accepted) void c.save(); }); }
  }} /></label>;
}

export function SpreadsheetDrawingInspector({ controller: c }: { controller: SpreadsheetController }) {
  const drawing = c.activeSheet.drawings?.find(item => item.id === c.selectedDrawingId);
  if (!drawing || !visibleDrawing(drawing, c)) return null;
  return <DrawingInspectorSession key={`${c.activeSheet.id}:${drawing.id}:${c.readOnly}`} controller={c} drawing={drawing} />;
}

function DrawingInspectorSession({ controller: c, drawing }: { controller: SpreadsheetController; drawing: SpreadsheetDrawing }) {
  const update = (patch: SpreadsheetDrawingPatch) => !c.disabled && updateDrawingFromUI(c, c.activeSheet.id, drawing, patch);
  return <aside className="lxs-drawing-inspector" aria-label="オブジェクトの設定" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()} onKeyDown={event => { if ((event.target as HTMLElement).closest("input,textarea,select")) return; if (event.key === "Escape") { event.preventDefault(); c.selectDrawing(null); c.requestGridFocus(); } }}>
    <div className="lxs-object-heading"><strong>{drawingLabel(drawing)}</strong><Command label="オブジェクトの選択を解除" onClick={() => { c.selectDrawing(null); c.requestGridFocus(); }}><Icon name="close" /></Command></div>
    <p className="lxs-object-position">{cellAddress(drawing.anchor.row, drawing.anchor.column)} に配置</p>
    {c.features.resize && <div className="lxs-object-properties"><PropertyField label="幅" type="number" value={drawing.width} controller={c} onCommit={value => update({ width: Number(value) })} /><PropertyField label="高さ" type="number" value={drawing.height} controller={c} onCommit={value => update({ height: Number(value) })} /></div>}
    {drawing.type === "image" && <PropertyField label="代替テキスト" value={drawing.alt} controller={c} onCommit={alt => update({ alt })} />}
    {drawing.type === "shape" && <>
      {!["line", "arrow"].includes(drawing.shape) && <PropertyField label="塗りつぶし" value={drawing.fill} controller={c} onCommit={fill => update({ fill })} />}
      <PropertyField label="線の色" value={drawing.stroke} controller={c} onCommit={stroke => update({ stroke })} />
      <PropertyField label="線の太さ" type="number" value={drawing.strokeWidth} controller={c} onCommit={value => update({ strokeWidth: Number(value) })} />
    </>}
    {drawing.type === "text" && <>
      <PropertyField label="文字サイズ" type="number" value={drawing.fontSize} controller={c} onCommit={value => update({ fontSize: Number(value) })} />
      <PropertyField label="文字色" value={drawing.color} controller={c} onCommit={color => update({ color })} />
      <PropertyField label="背景色" value={drawing.background} controller={c} onCommit={background => update({ background })} />
      <label className="lxs-object-bold"><input type="checkbox" checked={!!drawing.bold} disabled={c.disabled} onChange={event => update({ bold: event.target.checked })} />太字</label>
      <p className="lxs-object-hint">ダブルクリックまたは Enter で文章を編集</p>
    </>}
    {!c.readOnly && <button type="button" className="lxs-object-delete" disabled={c.disabled} onClick={() => { c.afterCommand({ type: "drawings.delete", sheetId: c.activeSheet.id, drawingId: drawing.id }, () => { c.selectDrawing(null); c.requestGridFocus(); }); }}>オブジェクトを削除</button>}
  </aside>;
}
