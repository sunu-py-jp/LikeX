"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import type { SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";
import { boundedDrawingRectangle, drawingAnchor, drawingRectangle, resizeDrawingRectangle, type DrawingGeometry, type DrawingResizeCorner, type DrawingResizeRectangle } from "../../state/drawing-geometry";
import { drawingRotationAtPointer } from "../../state/drawing-rotation";
import { normalizeDrawingRotation } from "../../model/drawing-transform";
import { blurObjectEditor } from "../../state/blur-object-editor";
import { visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

type GestureRectangle = DrawingResizeRectangle & { rotation: number };
type Gesture = { id: string; sheetId: string; workbook: Workbook; kind: "move" | "resize" | "rotate"; corner: DrawingResizeCorner; image: boolean; start: { x: number; y: number }; initial: GestureRectangle; preview: GestureRectangle; pointerId: number; target: HTMLElement };

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
    return !!drawing && !current.disabled && (session.kind === "move" || current.features.resize) && visibleDrawing(drawing, current) && current.getWorkbook() === session.workbook && current.activeSheet.id === session.sheetId && current.selectedDrawingId === session.id;
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
  const start = (event: PointerEvent<HTMLElement>, drawing: SpreadsheetDrawing, kind: Gesture["kind"], corner: DrawingResizeCorner = "se") => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("textarea,input,select")) return;
    blurObjectEditor(event.currentTarget);
    event.stopPropagation(); event.preventDefault();
    // A permission wait can outlive pointerup; only start a drag during this pointer event.
    const target = event.currentTarget;
    let synchronous = true;
    c.afterCommit(() => {
    c.selectDrawing(drawing.id); target.focus({ preventScroll: true });
    if (!synchronous) return;
    if (c.disabled || !visibleDrawing(drawing, c) || c.editing || (kind !== "move" && !c.features.resize)) return;
    const initial = { ...drawingRectangle(drawing, geometry), flipX: !!drawing.flipX, flipY: !!drawing.flipY, rotation: drawing.rotation ?? 0 };
    const session: Gesture = { id: drawing.id, sheetId: c.activeSheet.id, workbook: c.workbook, kind, corner, image: drawing.type === "image", start: point(event), initial, preview: initial, pointerId: event.pointerId, target: event.currentTarget };
    target.setPointerCapture(event.pointerId); gesture.current = session; setPreview(session);
    });
    synchronous = false;
  };
  const move = (event: PointerEvent) => {
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!eligible(session)) { cancelGesture(); return; }
    const next = point(event), dx = next.x - session.start.x, dy = next.y - session.start.y;
    const rectangle = session.kind === "move" ? { ...session.initial,
      ...boundedDrawingRectangle({ ...session.initial, left: session.initial.left + dx, top: session.initial.top + dy }, latest.current.geometry),
      width: session.initial.width, height: session.initial.height }
      : session.kind === "rotate" ? { ...session.initial, rotation: drawingRotationAtPointer(session.initial, session.initial.rotation, session.start, next, event.shiftKey) }
      : { ...session.initial, ...resizeDrawingRectangle(session.initial, session.corner, { x: dx, y: dy }, latest.current.geometry,
        { ...session.initial, preserveAspectRatio: session.image }) };
    const changed = { ...session, preview: rectangle }; gesture.current = changed; setPreview(changed);
  };
  const finish = (event: PointerEvent) => {
    // Use the release coordinates even when the last pointermove was coalesced.
    move(event);
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const valid = eligible(session);
    cancelGesture();
    if (!valid) return;
    const { preview: rectangle, initial } = session;
    if (rectangle.left === initial.left && rectangle.top === initial.top && rectangle.width === initial.width && rectangle.height === initial.height && rectangle.flipX === initial.flipX && rectangle.flipY === initial.flipY && rectangle.rotation === initial.rotation) return;
    const current = latest.current.c;
    const drawing = current.activeSheet.drawings?.find(item => item.id === session.id);
    if (drawing) updateDrawingFromUI(current, session.sheetId, drawing,
      session.kind === "rotate" ? { rotation: rectangle.rotation }
        : session.kind === "move" ? { anchor: drawingAnchor(rectangle.left, rectangle.top, latest.current.geometry) }
        : { anchor: drawingAnchor(rectangle.left, rectangle.top, latest.current.geometry), width: rectangle.width, height: rectangle.height,
          flipX: rectangle.flipX, flipY: rectangle.flipY });
  };
  const remove = (drawing: SpreadsheetDrawing) => {
    if (c.disabled || !visibleDrawing(drawing, c)) return;
    c.afterCommand({ type: "drawings.delete", sheetId: c.activeSheet.id, drawingId: drawing.id }, () => { c.selectDrawing(null); c.requestGridFocus(); });
  };
  const keyDown = (event: KeyboardEvent, drawing: SpreadsheetDrawing) => {
    if ((event.target as HTMLElement).closest("textarea,input,select")) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (gesture.current) cancelGesture(); else { setEditingText(null); c.selectDrawing(null); c.requestGridFocus(); } return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(drawing); return; }
    if (event.key === "Enter" && drawing.type !== "image" && !c.disabled) { event.preventDefault(); event.stopPropagation(); c.selectDrawing(drawing.id); setEditingText(drawing.id); return; }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key] && !c.disabled) {
      event.preventDefault(); event.stopPropagation();
      const [dx, dy] = directions[event.key], multiplier = event.shiftKey ? 10 : 1, rect = drawingRectangle(drawing, geometry);
      updateDrawingFromUI(c, c.activeSheet.id, drawing, { anchor: drawingAnchor(rect.left + dx * multiplier, rect.top + dy * multiplier, geometry) });
    }
  };
  const resizeKeyDown = (event: KeyboardEvent, drawing: SpreadsheetDrawing, corner: DrawingResizeCorner = "se") => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (c.disabled || !c.features.resize || !visibleDrawing(drawing, c)) return;
    const delta = (event.shiftKey ? 10 : 1) * (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
    const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
    const rectangle = resizeDrawingRectangle(drawingRectangle(drawing, geometry), corner, { x: horizontal ? delta : 0, y: horizontal ? 0 : delta }, geometry,
      { flipX: drawing.flipX, flipY: drawing.flipY, rotation: drawing.rotation, preserveAspectRatio: drawing.type === "image", axis: horizontal ? "x" : "y" });
    updateDrawingFromUI(c, c.activeSheet.id, drawing, { anchor: drawingAnchor(rectangle.left, rectangle.top, geometry), width: rectangle.width, height: rectangle.height,
      flipX: rectangle.flipX, flipY: rectangle.flipY });
  };
  const rotateKeyDown = (event: KeyboardEvent, drawing: SpreadsheetDrawing) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (c.disabled || !c.features.resize || !visibleDrawing(drawing, c)) return;
    const delta = (event.shiftKey ? 15 : 1) * (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
    updateDrawingFromUI(c, c.activeSheet.id, drawing, { rotation: event.key === "Home" ? 0 : normalizeDrawingRotation((drawing.rotation ?? 0) + delta) });
  };
  const lostPointerCapture = (id: string) => { if (gesture.current?.id === id) cancelGesture(); };
  return { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown, rotateKeyDown };
}
