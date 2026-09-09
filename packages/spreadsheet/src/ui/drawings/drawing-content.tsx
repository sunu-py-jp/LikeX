"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";

export function Shape({ drawing }: { drawing: Extract<SpreadsheetDrawing, { type: "shape" }> }) {
  const marker = useId().replace(/:/g, "");
  const stroke = drawing.strokeWidth;
  return <svg className="lxs-shape" width="100%" height="100%" viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true" overflow="visible">
    {drawing.shape === "arrow" && <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 9 4.5 0 9 2 4.5Z" fill={drawing.stroke} /></marker></defs>}
    {drawing.shape === "rectangle" ? <rect x={stroke / 2} y={stroke / 2} width={Math.max(0, drawing.width - stroke)} height={Math.max(0, drawing.height - stroke)} fill={drawing.fill} stroke={drawing.stroke} strokeWidth={stroke} />
      : drawing.shape === "ellipse" ? <ellipse cx={drawing.width / 2} cy={drawing.height / 2} rx={Math.max(0, (drawing.width - stroke) / 2)} ry={Math.max(0, (drawing.height - stroke) / 2)} fill={drawing.fill} stroke={drawing.stroke} strokeWidth={stroke} />
        : <line x1={Math.max(stroke, 4)} y1={Math.max(stroke, 4)} x2={Math.max(stroke, drawing.width - (drawing.shape === "arrow" ? stroke * 7 : stroke))} y2={Math.max(stroke, drawing.height - (drawing.shape === "arrow" ? stroke * 7 : stroke))} stroke={drawing.stroke} strokeWidth={stroke} markerEnd={drawing.shape === "arrow" ? `url(#${marker})` : undefined} />}
  </svg>;
}

export function DrawingTextEditor({ drawing, controller: c, onDone }: { drawing: Extract<SpreadsheetDrawing, { type: "text" }>; controller: SpreadsheetController; onDone: () => void }) {
  const [text, setText] = useState(drawing.text);
  const starting = useRef(drawing);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const markPending = useObjectEditPending(c);
  useLayoutEffect(() => { textarea.current?.focus(); textarea.current?.select(); }, []);
  const commit = () => {
    if (cancelled.current) return true;
    if (c.disabled || !c.features.textBoxes || drawing !== starting.current) { onDone(); return false; }
    const accepted = text === drawing.text || c.executeCommand({ type: "textBoxes.update", sheetId: c.activeSheet.id, drawingId: drawing.id, patch: { text } }).ok;
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
