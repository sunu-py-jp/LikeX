"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { chainResult } from "../../core";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing } from "../../model";
import { shapeTextFrame } from "../../model/shapes";
import { DEFAULT_DRAWING_TEXT_INSETS } from "../../model/drawing-text";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useObjectEditPending } from "../../state/use-object-edit-pending";
import { visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

import { drawingTextStyle } from "./drawing-text-style";

export { Shape } from "./shape";
export { DrawingText } from "./drawing-text";

type TextDrawing = Exclude<SpreadsheetDrawing, { type: "image" }>;

export function DrawingTextEditor({ drawing, controller: c, onDone }: { drawing: TextDrawing; controller: SpreadsheetController; onDone: () => void }) {
  const originalText = drawing.text ?? "";
  const [text, setText] = useState(originalText);
  const starting = useRef(drawing);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const markPending = useObjectEditPending(c);
  const textStyle = drawingTextStyle(drawing);
  const insets = drawing.textInsets ?? DEFAULT_DRAWING_TEXT_INSETS;
  const frame = drawing.type === "shape" ? shapeTextFrame(drawing) : undefined;
  useLayoutEffect(() => {
    const editor = textarea.current;
    if (drawing.type !== "shape" || !editor) return;
    editor.style.height = "0px";
    editor.style.height = `${Math.min(editor.scrollHeight, Math.max(0, (frame?.height ?? drawing.height) - insets.top - insets.bottom))}px`;
  }, [text, drawing.type, drawing.width, drawing.height, drawing.fontSize, frame?.height, insets.top, insets.bottom]);
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
    readOnly={c.disabled || c.requesting} value={text} style={{ ...textStyle, overflow: "auto", clipPath: "none", ...(drawing.type === "shape" ? { padding: 0 } : {}) }}
    wrap={drawing.textWrap === "none" ? "off" : "soft"}
    onChange={event => { setText(event.target.value); markPending(event.target.value !== originalText); }} onBlur={event => { if (!(event?.relatedTarget as HTMLElement | null)?.closest(".lxs-search-dialog")) commit(); }} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); cancelled.current = true; c.cancelEditRequest(); markPending(false); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void chainResult(commit(), accepted => { if (accepted) void c.save(); }); }
    }} />;
  return drawing.type === "shape" ? <div className="lxs-shape-text-edit-frame" style={{ ...frame, right: "auto", bottom: "auto", padding: textStyle.padding, alignItems: ({ top: "flex-start", middle: "center", bottom: "flex-end" } as const)[drawing.textVerticalAlign ?? "middle"] }}>{editor}</div> : editor;
}
