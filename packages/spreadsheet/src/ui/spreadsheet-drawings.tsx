"use client";

/* The copyable component displays validated local data URLs without Next.js. */
/* eslint-disable @next/next/no-img-element */

import { useId, useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { cellAddress, deleteDrawing, updateDrawing, SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetDrawingPatch } from "../model";
import type { SpreadsheetController, Workbook } from "../state/use-spreadsheet";
import { boundedDrawingRectangle, drawingAnchor, drawingRectangle, type DrawingGeometry, type DrawingRectangle } from "../state/drawing-geometry";
import { useObjectEditPending } from "../state/use-object-edit-pending";
import { blurObjectEditor } from "../state/blur-object-editor";
import { Command, Icon } from "./spreadsheet-controls";

export function visibleDrawing(drawing: SpreadsheetDrawing, c: SpreadsheetController) {
  return drawing.type === "image" ? c.features.images : drawing.type === "shape" ? c.features.shapes : c.features.textBoxes;
}
function drawingLabel(drawing: SpreadsheetDrawing) {
  return drawing.type === "image" ? drawing.alt || "画像" : drawing.type === "text" ? `テキストボックス${drawing.text ? `: ${drawing.text.slice(0, 40)}` : ""}`
    : ({ rectangle: "四角形", ellipse: "楕円", line: "直線", arrow: "矢印" } as const)[drawing.shape];
}
function Shape({ drawing }: { drawing: Extract<SpreadsheetDrawing, { type: "shape" }> }) {
  const marker = useId().replace(/:/g, "");
  const stroke = drawing.strokeWidth;
  return <svg className="lxs-shape" width="100%" height="100%" viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true" overflow="visible">
    {drawing.shape === "arrow" && <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 9 4.5 0 9 2 4.5Z" fill={drawing.stroke} /></marker></defs>}
    {drawing.shape === "rectangle" ? <rect x={stroke / 2} y={stroke / 2} width={Math.max(0, drawing.width - stroke)} height={Math.max(0, drawing.height - stroke)} fill={drawing.fill} stroke={drawing.stroke} strokeWidth={stroke} />
      : drawing.shape === "ellipse" ? <ellipse cx={drawing.width / 2} cy={drawing.height / 2} rx={Math.max(0, (drawing.width - stroke) / 2)} ry={Math.max(0, (drawing.height - stroke) / 2)} fill={drawing.fill} stroke={drawing.stroke} strokeWidth={stroke} />
        : <line x1={Math.max(stroke, 4)} y1={Math.max(stroke, 4)} x2={Math.max(stroke, drawing.width - (drawing.shape === "arrow" ? stroke * 7 : stroke))} y2={Math.max(stroke, drawing.height - (drawing.shape === "arrow" ? stroke * 7 : stroke))} stroke={drawing.stroke} strokeWidth={stroke} markerEnd={drawing.shape === "arrow" ? `url(#${marker})` : undefined} />}
  </svg>;
}

type Gesture = { id: string; sheetId: string; workbook: Workbook; kind: "move" | "resize"; start: { x: number; y: number }; initial: DrawingRectangle; preview: DrawingRectangle; pointerId: number; target: HTMLElement };

export function SpreadsheetDrawings({ controller: c, geometry }: { controller: SpreadsheetController; geometry: DrawingGeometry }) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ c, geometry });
  useLayoutEffect(() => { latest.current = { c, geometry }; });
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const currentDrawings = (c.activeSheet.drawings ?? []).filter(drawing => visibleDrawing(drawing, c));
  const eligible = (session: Gesture) => {
    const current = latest.current.c;
    const drawing = current.activeSheet.drawings?.find(item => item.id === session.id);
    return !!drawing && !current.disabled && (session.kind !== "resize" || current.features.resize) && visibleDrawing(drawing, current) && current.workbook === session.workbook && current.activeSheet.id === session.sheetId && current.selectedDrawingId === session.id;
  };
  const point = (event: PointerEvent) => {
    const rect = layer.current!.getBoundingClientRect();
    const width = geometry.columnOffsets.at(-1)!;
    const height = geometry.rowOffsets.at(-1)!;
    return { x: (event.clientX - rect.left) * (rect.width ? width / rect.width : 1), y: (event.clientY - rect.top) * (rect.height ? height / rect.height : 1) };
  };
  const cancelGesture = () => {
    const session = gesture.current;
    gesture.current = null; setPreview(null);
    if (session?.target.hasPointerCapture(session.pointerId)) session.target.releasePointerCapture(session.pointerId);
  };
  const start = (event: PointerEvent<HTMLElement>, drawing: SpreadsheetDrawing, kind: Gesture["kind"]) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("textarea,input,select")) return;
    blurObjectEditor(event.currentTarget);
    event.stopPropagation(); event.preventDefault();
    if (!c.commitEdit()) return;
    c.selectDrawing(drawing.id); event.currentTarget.focus({ preventScroll: true });
    if (c.disabled || !visibleDrawing(drawing, c) || c.editing || (kind === "resize" && !c.features.resize)) return;
    const initial = drawingRectangle(drawing, geometry);
    const session: Gesture = { id: drawing.id, sheetId: c.activeSheet.id, workbook: c.workbook, kind, start: point(event), initial, preview: initial, pointerId: event.pointerId, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId); gesture.current = session; setPreview(session);
  };
  const move = (event: PointerEvent) => {
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!eligible(session)) { cancelGesture(); return; }
    const next = point(event), dx = next.x - session.start.x, dy = next.y - session.start.y;
    const bounded = boundedDrawingRectangle(session.kind === "move" ? { ...session.initial, left: session.initial.left + dx, top: session.initial.top + dy }
      : { ...session.initial, width: session.initial.width + dx, height: session.initial.height + dy }, latest.current.geometry);
    const rectangle = session.kind === "move" ? { ...bounded, width: session.initial.width, height: session.initial.height } : bounded;
    const changed = { ...session, preview: rectangle }; gesture.current = changed; setPreview(changed);
  };
  const finish = (event: PointerEvent) => {
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const valid = eligible(session);
    cancelGesture();
    if (!valid) return;
    const { preview: rectangle, initial } = session;
    if (rectangle.left === initial.left && rectangle.top === initial.top && rectangle.width === initial.width && rectangle.height === initial.height) return;
    latest.current.c.apply(wb => updateDrawing(wb, session.sheetId, session.id,
      session.kind === "move" ? { anchor: drawingAnchor(rectangle.left, rectangle.top, latest.current.geometry) } : { width: Math.round(rectangle.width), height: Math.round(rectangle.height) }));
  };
  const remove = (drawing: SpreadsheetDrawing) => {
    if (c.disabled || !visibleDrawing(drawing, c)) return;
    if (c.apply(wb => deleteDrawing(wb, c.activeSheet.id, drawing.id))) { c.selectDrawing(null); c.requestGridFocus(); }
  };
  const keyDown = (event: KeyboardEvent, drawing: SpreadsheetDrawing) => {
    if ((event.target as HTMLElement).closest("textarea,input,select")) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (gesture.current) cancelGesture(); else { setEditingText(null); c.selectDrawing(null); c.requestGridFocus(); } return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(drawing); return; }
    if (event.key === "Enter" && drawing.type === "text" && !c.disabled) { event.preventDefault(); event.stopPropagation(); c.selectDrawing(drawing.id); setEditingText(drawing.id); return; }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key] && !c.disabled) {
      event.preventDefault(); event.stopPropagation();
      const [dx, dy] = directions[event.key], multiplier = event.shiftKey ? 10 : 1, rect = drawingRectangle(drawing, geometry);
      c.apply(wb => updateDrawing(wb, c.activeSheet.id, drawing.id, { anchor: drawingAnchor(rect.left + dx * multiplier, rect.top + dy * multiplier, geometry) }));
    }
  };
  return <div ref={layer} className="lxs-drawing-layer" role="group" aria-label="シート上のオブジェクト" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}>
    {currentDrawings.map(drawing => {
      const rectangle = preview?.id === drawing.id && preview.workbook === c.workbook && !c.disabled ? preview.preview : drawingRectangle(drawing, geometry);
      const selected = c.selectedDrawingId === drawing.id;
      const resource = drawing.type === "image" ? c.workbook.resources?.images?.[drawing.resourceId] : undefined;
      return <div key={drawing.id} data-lxs-drawing={drawing.id} role="group" aria-label={drawingLabel(drawing)} aria-roledescription={drawing.type === "image" ? "画像" : drawing.type === "text" ? "テキストボックス" : "図形"} tabIndex={0}
        className={`lxs-drawing ${selected ? "lxs-drawing-selected" : ""} ${c.disabled ? "lxs-drawing-readonly" : ""}`}
        style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height }}
        onFocus={() => c.selectDrawing(drawing.id)} onPointerDown={event => start(event, drawing, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gesture.current?.id === drawing.id) cancelGesture(); }} onKeyDown={event => keyDown(event, drawing)}
        onDoubleClick={() => { if (drawing.type === "text" && !c.disabled) setEditingText(drawing.id); }}>
        {drawing.type === "image" ? resource ? <img src={resource.dataUrl} alt={drawing.alt} draggable={false} decoding="async" /> : <span className="lxs-image-missing">画像を表示できません</span>
          : drawing.type === "shape" ? <Shape drawing={{ ...drawing, width: rectangle.width, height: rectangle.height }} />
            : editingText === drawing.id && selected && !c.disabled ? <DrawingTextEditor key={drawing.id} drawing={drawing} controller={c} onDone={() => setEditingText(null)} />
              : <div className="lxs-text-box" style={{ fontSize: drawing.fontSize, color: drawing.color, background: drawing.background, fontWeight: drawing.bold ? 700 : 400 }}>{drawing.text || "テキストを入力"}</div>}
        {selected && !c.disabled && c.features.resize && <button type="button" className="lxs-drawing-resize" aria-label={`${drawingLabel(drawing)}のサイズを変更`} title="ドラッグまたは矢印キーでサイズを変更" onPointerDown={event => start(event, drawing, "resize")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const delta = (event.shiftKey ? 10 : 1) * (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
            const patch = ["ArrowLeft", "ArrowRight"].includes(event.key) ? { width: Math.min(10000, Math.max(16, drawing.width + delta)) } : { height: Math.min(10000, Math.max(16, drawing.height + delta)) };
            c.apply(wb => updateDrawing(wb, c.activeSheet.id, drawing.id, patch));
          }} />}
      </div>;
    })}
  </div>;
}

function DrawingTextEditor({ drawing, controller: c, onDone }: { drawing: Extract<SpreadsheetDrawing, { type: "text" }>; controller: SpreadsheetController; onDone: () => void }) {
  const [text, setText] = useState(drawing.text);
  const starting = useRef(drawing);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const markPending = useObjectEditPending(c);
  useLayoutEffect(() => { textarea.current?.focus(); textarea.current?.select(); }, []);
  const commit = () => {
    if (cancelled.current) return true;
    if (c.disabled || !c.features.textBoxes || drawing !== starting.current) { onDone(); return false; }
    const accepted = text === drawing.text || c.apply(wb => updateDrawing(wb, c.activeSheet.id, drawing.id, { text }));
    if (accepted) { markPending(false); onDone(); }
    return accepted;
  };
  return <textarea ref={textarea} aria-label="テキストボックスの内容" className="lxs-drawing-text-editor" maxLength={SPREADSHEET_LIMITS.drawingTextLength} value={text} style={{ fontSize: drawing.fontSize, color: drawing.color, background: drawing.background, fontWeight: drawing.bold ? 700 : 400 }}
    onChange={event => { setText(event.target.value); markPending(event.target.value !== drawing.text); }} onBlur={commit} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); cancelled.current = true; markPending(false); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (commit()) void c.save(); }
    }} />;
}

function PropertyField({ label, value, onCommit, controller: c, type = "text" }: { label: string; value: string | number; onCommit: (value: string) => boolean; controller: SpreadsheetController; type?: "text" | "number" }) {
  const [draft, setDraft] = useState<string | null>(null);
  const markPending = useObjectEditPending(c);
  const base = String(value), text = draft ?? base;
  const commit = () => {
    const accepted = text === base || (!c.disabled && onCommit(text));
    if (accepted) { setDraft(null); markPending(false); }
    return accepted;
  };
  return <label className="lxs-object-property"><span>{label}</span><input type={type} value={text} disabled={c.disabled} aria-label={label} onChange={event => { setDraft(event.target.value); markPending(event.target.value !== base); }} onBlur={commit} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); setDraft(null); markPending(false); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (commit()) void c.save(); }
  }} /></label>;
}

export function SpreadsheetDrawingInspector({ controller: c }: { controller: SpreadsheetController }) {
  const drawing = c.activeSheet.drawings?.find(item => item.id === c.selectedDrawingId);
  if (!drawing || !visibleDrawing(drawing, c)) return null;
  return <DrawingInspectorSession key={`${c.activeSheet.id}:${drawing.id}:${c.disabled}`} controller={c} drawing={drawing} />;
}

function DrawingInspectorSession({ controller: c, drawing }: { controller: SpreadsheetController; drawing: SpreadsheetDrawing }) {
  const update = (patch: SpreadsheetDrawingPatch) => !c.disabled && c.apply(wb => updateDrawing(wb, c.activeSheet.id, drawing.id, patch));
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
    {!c.readOnly && <button type="button" className="lxs-object-delete" disabled={c.disabled} onClick={() => { if (c.apply(wb => deleteDrawing(wb, c.activeSheet.id, drawing.id))) { c.selectDrawing(null); c.requestGridFocus(); } }}>オブジェクトを削除</button>}
  </aside>;
}
