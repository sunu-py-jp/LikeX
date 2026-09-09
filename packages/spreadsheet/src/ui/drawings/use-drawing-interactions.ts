"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { deleteDrawing, updateDrawing, type SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";
import { boundedDrawingRectangle, drawingAnchor, drawingRectangle, type DrawingGeometry, type DrawingRectangle } from "../../state/drawing-geometry";
import { blurObjectEditor } from "../../state/blur-object-editor";
import { visibleDrawing } from "./drawing-helpers";

type Gesture = { id: string; sheetId: string; workbook: Workbook; kind: "move" | "resize"; start: { x: number; y: number }; initial: DrawingRectangle; preview: DrawingRectangle; pointerId: number; target: HTMLElement };

/** Owns drag previews, keyboard movement, resizing and drawing edit sessions. */
export function useDrawingInteractions(c: SpreadsheetController, geometry: DrawingGeometry) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ c, geometry });
  useLayoutEffect(() => { latest.current = { c, geometry }; });
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
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
  const resizeKeyDown = (event: KeyboardEvent, drawing: SpreadsheetDrawing) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.shiftKey ? 10 : 1) * (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
    const patch = ["ArrowLeft", "ArrowRight"].includes(event.key) ? { width: Math.min(10000, Math.max(16, drawing.width + delta)) } : { height: Math.min(10000, Math.max(16, drawing.height + delta)) };
    c.apply(wb => updateDrawing(wb, c.activeSheet.id, drawing.id, patch));
  };
  const lostPointerCapture = (id: string) => { if (gesture.current?.id === id) cancelGesture(); };
  return { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown };
}
