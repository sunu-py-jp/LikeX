"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { chainResult } from "../../core";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";
import { drawingTextColor, visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

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

type TextDrawing = Exclude<SpreadsheetDrawing, { type: "image" }>;

export function DrawingText({ drawing }: { drawing: TextDrawing }) {
  return <div className={drawing.type === "shape" ? "lxs-shape-text" : "lxs-text-box"}
    style={{ fontSize: drawing.fontSize ?? 16, color: drawingTextColor(drawing),
      background: drawing.type === "text" ? drawing.background : undefined, fontWeight: drawing.bold ? 700 : 400 }}>
    <span>{drawing.text || (drawing.type === "text" ? "テキストを入力" : "")}</span>
  </div>;
}

export function DrawingTextEditor({ drawing, controller: c, onDone }: { drawing: TextDrawing; controller: SpreadsheetController; onDone: () => void }) {
  const originalText = drawing.text ?? "";
  const [text, setText] = useState(originalText);
  const starting = useRef(drawing);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const markPending = useObjectEditPending(c);
  useLayoutEffect(() => {
    const editor = textarea.current;
    if (drawing.type !== "shape" || !editor) return;
    editor.style.height = "0px";
    editor.style.height = `${Math.min(editor.scrollHeight, Math.max(0, drawing.height - 16))}px`;
  }, [text, drawing.type, drawing.width, drawing.height, drawing.fontSize]);
  useLayoutEffect(() => { textarea.current?.focus(); textarea.current?.select(); }, []);
  const commit = () => {
    if (cancelled.current) return true;
    if (c.disabled || !visibleDrawing(drawing, c) || drawing !== starting.current) { onDone(); return false; }
    const result = text === originalText ? true : updateDrawingFromUI(c, c.activeSheet.id, drawing, { text });
    return chainResult(result, accepted => {
      if (accepted && !cancelled.current) { markPending(false); onDone(); }
      return accepted;
    });
  };
  const editor = <textarea ref={textarea} aria-label={drawing.type === "shape" ? "図形の文字" : "テキストボックスの内容"}
    className={`lxs-drawing-text-editor${drawing.type === "shape" ? " lxs-shape-text-editor" : ""}`} maxLength={SPREADSHEET_LIMITS.drawingTextLength}
    readOnly={c.disabled || c.requesting} value={text} style={{ fontSize: drawing.fontSize ?? 16, color: drawingTextColor(drawing),
      background: drawing.type === "text" ? drawing.background : "transparent", fontWeight: drawing.bold ? 700 : 400 }}
    onChange={event => { setText(event.target.value); markPending(event.target.value !== originalText); }} onBlur={commit} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); cancelled.current = true; c.cancelEditRequest(); markPending(false); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void chainResult(commit(), accepted => { if (accepted) void c.save(); }); }
    }} />;
  return drawing.type === "shape" ? <div className="lxs-shape-text-edit-frame">{editor}</div> : editor;
}
