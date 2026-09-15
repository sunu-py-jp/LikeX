"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { chainResult } from "../../core";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing } from "../../model";
import { shapeTextFrame } from "../../model/shapes";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";
import { drawingTextColor, visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

export { Shape } from "./shape";

type TextDrawing = Exclude<SpreadsheetDrawing, { type: "image" }>;

export function DrawingText({ drawing }: { drawing: TextDrawing }) {
  return <div className={drawing.type === "shape" ? "lxs-shape-text" : "lxs-text-box"}
    style={{ fontSize: drawing.fontSize ?? 16, color: drawingTextColor(drawing),
      background: drawing.type === "text" ? drawing.background : undefined, fontWeight: drawing.bold ? 700 : 400,
      ...(drawing.type === "shape" ? { ...shapeTextFrame(drawing), right: "auto", bottom: "auto" } : {}) }}>
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
  const frame = drawing.type === "shape" ? shapeTextFrame(drawing) : undefined;
  useLayoutEffect(() => {
    const editor = textarea.current;
    if (drawing.type !== "shape" || !editor) return;
    editor.style.height = "0px";
    editor.style.height = `${Math.min(editor.scrollHeight, Math.max(0, (frame?.height ?? drawing.height) - 16))}px`;
  }, [text, drawing.type, drawing.width, drawing.height, drawing.fontSize, frame?.height]);
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
  return drawing.type === "shape" ? <div className="lxs-shape-text-edit-frame" style={{ ...frame, right: "auto", bottom: "auto" }}>{editor}</div> : editor;
}
