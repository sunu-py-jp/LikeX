"use client";

import { useRef, useState } from "react";
import { chainResult, CONNECTOR_ARROWHEADS, type ConnectorArrowhead, type MaybePromise } from "../../core";
import { cellAddress, type SpreadsheetDrawing, type SpreadsheetDrawingPatch } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";
import { Command, Icon } from "../spreadsheet-controls";
import { DEFAULT_SHAPE_TEXT_COLOR, drawingLabel, drawingTextColor, visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";
import { ColorPropertyField } from "./color-property-field";
import { getSpreadsheetLinePoints, isSpreadsheetLine } from "../../model/lines";

function PropertyField({ label, value, onCommit, controller: c, type = "text" }: { label: string; value: string | number; onCommit: (value: string) => MaybePromise<boolean>; controller: SpreadsheetController; type?: "text" | "number" }) {
  const [draft, setDraft] = useState<string | null>(null);
  const generation = useRef(0);
  const markPending = useObjectEditPending(c);
  // Display useful precision without rounding the stored proportional dimensions.
  const base = typeof value === "number" ? String(Number(value.toPrecision(6))) : String(value), text = draft ?? base;
  const commit = () => {
    const version = generation.current;
    return chainResult(text === base || (!c.disabled && onCommit(text)), accepted => {
      if (accepted && generation.current === version) { setDraft(null); markPending(false); }
      return accepted;
    });
  };
  return <label className="lxs-object-property"><span>{label}</span><input type={type} step={type === "number" ? "any" : undefined} value={text} disabled={c.disabled || c.requesting} aria-label={label} onChange={event => { generation.current++; setDraft(event.target.value); markPending(event.target.value !== base); }} onBlur={commit} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const primary = (event.metaKey || event.ctrlKey) && !(event.metaKey && event.ctrlKey) && !event.altKey;
    const key = event.key.toLowerCase();
    // Once Enter/blur commits a property, Undo belongs to the workbook even if
    // focus is still in this input. An unfinished draft retains native text Undo.
    if (primary && (key === "z" || key === "y") && draft === null && !c.pendingObjectEdit && !c.editing &&
      !c.readOnly && c.features.undoRedo) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) c.redo(); else c.undo();
      return;
    }
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
  const line = isSpreadsheetLine(drawing) ? getSpreadsheetLinePoints(c.activeSheet, drawing.id) : undefined;
  const updatePoint = (endpoint: "start" | "end", axis: "x" | "y", value: string) => {
    if (c.disabled || !line) return false;
    const next = { x: line[endpoint].x, y: line[endpoint].y, [axis]: Number(value) };
    return chainResult(c.executeCommand({ type: "lines.update", sheetId: c.activeSheet.id, drawingId: drawing.id, ...line, [endpoint]: next }), result => result.ok);
  };
  return <aside className="lxs-drawing-inspector" aria-label="オブジェクトの設定" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()} onKeyDown={event => { if ((event.target as HTMLElement).closest("input,textarea,select")) return; if (event.key === "Escape") { event.preventDefault(); c.selectDrawing(null); c.requestGridFocus(); } }}>
    <div className="lxs-object-heading"><strong>{drawingLabel(drawing)}</strong><Command label="オブジェクトの選択を解除" onClick={() => { c.selectDrawing(null); c.requestGridFocus(); }}><Icon name="close" /></Command></div>
    <p className="lxs-object-position">{cellAddress(drawing.anchor.row, drawing.anchor.column)} に配置</p>
    {c.features.resize && !line && <div className="lxs-object-properties"><PropertyField label="幅" type="number" value={drawing.width} controller={c} onCommit={value => update({ width: Number(value) })} /><PropertyField label="高さ" type="number" value={drawing.height} controller={c} onCommit={value => update({ height: Number(value) })} /></div>}
    {c.features.resize && !line && <PropertyField label="角度（°）" type="number" value={drawing.rotation ?? 0} controller={c} onCommit={value => update({ rotation: Number(value) })} />}
    {c.features.resize && line && (["start", "end"] as const).map(endpoint => <div key={endpoint} className="lxs-object-properties">
      {(["x", "y"] as const).map(axis => <PropertyField key={axis} label={`${endpoint === "start" ? "始点" : "終点"}${axis.toUpperCase()}`} type="number" value={line[endpoint][axis]} controller={c} onCommit={value => updatePoint(endpoint, axis, value)} />)}
      {line[endpoint].binding && <span>{endpoint === "start" ? "始点" : "終点"}は図形に接続中</span>}
    </div>)}
    {isSpreadsheetLine(drawing) && <label className="lxs-object-property"><span>線の経路</span>
      <select aria-label="線の経路" disabled={c.disabled || c.requesting} value={drawing.routing ?? "straight"}
        onChange={event => c.afterCommit(() => c.afterCommand({ type: "lines.update", sheetId: c.activeSheet.id, drawingId: drawing.id, routing: event.target.value as "straight" | "elbow" }))}>
        <option value="straight">直線</option><option value="elbow">自動の折れ線</option>
      </select></label>}
    {isSpreadsheetLine(drawing) && (["start", "end"] as const).map(endpoint => <label key={`${endpoint}-arrow`} className="lxs-object-property"><span>{endpoint === "start" ? "始点の矢印" : "終点の矢印"}</span>
      <select aria-label={endpoint === "start" ? "始点の矢印" : "終点の矢印"} disabled={c.disabled || c.requesting} value={drawing[endpoint === "start" ? "startArrow" : "endArrow"] ?? (endpoint === "end" && drawing.shape === "arrow" ? "triangle" : "none")}
        onChange={event => c.afterCommit(() => c.afterCommand({ type: "lines.update", sheetId: c.activeSheet.id, drawingId: drawing.id, [endpoint === "start" ? "startArrow" : "endArrow"]: event.target.value as ConnectorArrowhead }))}>
        {CONNECTOR_ARROWHEADS.map(kind => <option key={kind} value={kind}>{{ none: "なし", triangle: "三角", openArrow: "開いた矢印", diamond: "ひし形", oval: "楕円", stealth: "切り込み矢印" }[kind]}</option>)}
      </select></label>)}
    {drawing.type === "image" && <PropertyField label="代替テキスト" value={drawing.alt} controller={c} onCommit={alt => update({ alt })} />}
    {drawing.type === "shape" && <>
      {!["line", "arrow"].includes(drawing.shape) && <ColorPropertyField label="塗りつぶし" value={drawing.fill} controller={c} reset={{label: "なし", value: "transparent"}} onCommit={fill => update({ fill })} />}
      <ColorPropertyField label="線の色" value={drawing.stroke} controller={c} reset={{label: "なし", value: "transparent"}} onCommit={stroke => update({ stroke })} />
      <PropertyField label="線の太さ" type="number" value={drawing.strokeWidth} controller={c} onCommit={value => update({ strokeWidth: Number(value) })} />
    </>}
    {drawing.type !== "image" && <>
      <PropertyField label="文字サイズ" type="number" value={drawing.fontSize ?? 16} controller={c} onCommit={value => update({ fontSize: Number(value) })} />
      <ColorPropertyField label="文字色" value={drawingTextColor(drawing)} controller={c}
        reset={{label: "自動", value: drawing.type === "shape" ? DEFAULT_SHAPE_TEXT_COLOR : "currentColor"}} onCommit={color => update({ color })} />
      {drawing.type === "text" && <ColorPropertyField label="背景色" value={drawing.background} controller={c} reset={{label: "なし", value: "transparent"}} onCommit={background => update({ background })} />}
      <label className="lxs-object-bold"><input type="checkbox" checked={!!drawing.bold} disabled={c.disabled} onChange={event => update({ bold: event.target.checked })} />太字</label>
      <p className="lxs-object-hint">{line ? "両端の丸をドラッグして図形の接続点へ接続します。離すと接続を解除します。" : "ダブルクリックまたは Enter で文章を編集"}</p>
    </>}
    {!c.readOnly && <button type="button" className="lxs-object-delete" disabled={c.disabled} onClick={() => { c.afterCommand({ type: "drawings.delete", sheetId: c.activeSheet.id, drawingId: drawing.id }, () => { c.selectDrawing(null); c.requestGridFocus(); }); }}>オブジェクトを削除</button>}
  </aside>;
}
