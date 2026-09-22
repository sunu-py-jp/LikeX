"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { getDragScrollDelta } from "../../core";
import type { SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";
import { boundedDrawingRectangle, drawingAnchor, drawingRectangle, resizeDrawingRectangle, type DrawingGeometry, type DrawingResizeCorner, type DrawingResizeRectangle } from "../../state/drawing-geometry";
import { drawingRotationAtPointer } from "../../state/drawing-rotation";
import { normalizeDrawingRotation } from "../../model/drawing-transform";
import { blurObjectEditor } from "../../state/blur-object-editor";
import { visibleDrawing } from "./drawing-helpers";
import { updateDrawingFromUI } from "./drawing-commands";

type GestureRectangle = DrawingResizeRectangle & { rotation: number };
type GesturePointer = Pick<PointerEvent, "clientX" | "clientY" | "pointerId" | "shiftKey">;
type Gesture = { id: string; sheetId: string; workbook: Workbook; drawing: SpreadsheetDrawing; zoom: number; kind: "move" | "resize" | "rotate"; corner: DrawingResizeCorner; image: boolean; start: { x: number; y: number }; initial: GestureRectangle; preview: GestureRectangle; pointer: GesturePointer; pointerId: number; target: HTMLElement };

/** Owns drag previews, keyboard movement, resizing and drawing edit sessions. */
export function useDrawingInteractions(c: SpreadsheetController, geometry: DrawingGeometry) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const tracking = useRef<{ resume(): void; dispose(): void } | null>(null);
  const latest = useRef({ c, geometry });
  useLayoutEffect(() => { latest.current = { c, geometry }; });
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const eligible = (session: Gesture) => {
    const current = latest.current.c;
    const drawing = current.activeSheet.drawings?.find(item => item.id === session.id);
    return drawing === session.drawing && !current.disabled && !current.editing && (session.kind === "move" || current.features.resize) && visibleDrawing(drawing, current) && current.getWorkbook() === session.workbook && current.activeSheet.id === session.sheetId && current.selectedDrawingId === session.id && (current.zoom ?? 100) === session.zoom;
  };
  const point = (event: GesturePointer) => {
    const rect = layer.current!.getBoundingClientRect();
    const width = latest.current.geometry.columnOffsets.at(-1)!;
    const height = latest.current.geometry.rowOffsets.at(-1)!;
    return { x: (event.clientX - rect.left) * (rect.width ? width / rect.width : 1), y: (event.clientY - rect.top) * (rect.height ? height / rect.height : 1) };
  };
  const stopGesture = (updatePreview: boolean) => {
    const session = gesture.current;
    gesture.current = null;
    tracking.current?.dispose(); tracking.current = null;
    if (updatePreview) setPreview(null);
    // Capture may already have ended or the node may have been detached.
    try { if (session?.target.hasPointerCapture(session.pointerId)) session.target.releasePointerCapture(session.pointerId); } catch { /* The gesture is already stopped. */ }
  };
  const cancelGesture = () => stopGesture(true);
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
    cancelGesture();
    const initial = { ...drawingRectangle(drawing, geometry), flipX: !!drawing.flipX, flipY: !!drawing.flipY, rotation: drawing.rotation ?? 0 };
    const session: Gesture = { id: drawing.id, sheetId: c.activeSheet.id, workbook: c.workbook, drawing, zoom: c.zoom ?? 100, kind, corner, image: drawing.type === "image", start: point(event), initial, preview: initial,
      pointer: { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, shiftKey: event.shiftKey }, pointerId: event.pointerId, target };
    target.setPointerCapture(event.pointerId); gesture.current = session; setPreview({ ...session });
    trackGesture(session);
    });
    synchronous = false;
  };
  const updatePreview = (event: GesturePointer) => {
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!eligible(session) || !layer.current) { cancelGesture(); return; }
    session.pointer = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, shiftKey: event.shiftKey };
    const next = point(event), dx = next.x - session.start.x, dy = next.y - session.start.y;
    const rectangle = session.kind === "move" ? { ...session.initial,
      ...boundedDrawingRectangle({ ...session.initial, left: session.initial.left + dx, top: session.initial.top + dy }, latest.current.geometry),
      width: session.initial.width, height: session.initial.height }
      : session.kind === "rotate" ? { ...session.initial, rotation: drawingRotationAtPointer(session.initial, session.initial.rotation, session.start, next, event.shiftKey) }
      : { ...session.initial, ...resizeDrawingRectangle(session.initial, session.corner, { x: dx, y: dy }, latest.current.geometry,
        { ...session.initial, preserveAspectRatio: session.image }) };
    const previous = session.preview;
    if (rectangle.left === previous.left && rectangle.top === previous.top && rectangle.width === previous.width && rectangle.height === previous.height && rectangle.flipX === previous.flipX && rectangle.flipY === previous.flipY && rectangle.rotation === previous.rotation) return;
    session.preview = rectangle; setPreview({ ...session });
  };
  const move = (event: GesturePointer) => {
    updatePreview(event);
    if (gesture.current?.pointerId === event.pointerId) tracking.current?.resume();
  };
  const finish = (event: GesturePointer) => {
    // Use the release coordinates even when the last pointermove was coalesced.
    updatePreview(event);
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
  function trackGesture(session: Gesture) {
    const element = layer.current;
    const scroller = element?.closest?.<HTMLElement>(".lxs-grid-scroll");
    const document = element?.ownerDocument ?? session.target.ownerDocument;
    const view = document?.defaultView;
    let frame: number | undefined, previousTime: number | undefined;
    const cancel = () => { if (gesture.current === session) cancelGesture(); };
    const pointerUp = (event: globalThis.PointerEvent) => { if (gesture.current === session) finish(event); };
    const pointerCancel = (event: globalThis.PointerEvent) => { if (event.pointerId === session.pointerId) cancel(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || gesture.current !== session) return;
      event.preventDefault(); event.stopPropagation(); cancel();
    };
    const refresh = () => { if (gesture.current === session) updatePreview(session.pointer); };
    const step = (time: number) => {
      frame = undefined;
      if (gesture.current !== session) return;
      if (!eligible(session) || !layer.current) { cancel(); return; }
      const elapsed = previousTime === undefined ? 16 : time - previousTime; previousTime = time;
      const currentGeometry = latest.current.geometry;
      const layerRect = layer.current.getBoundingClientRect(), viewport = scroller!.getBoundingClientRect();
      const scaleX = layerRect.width / currentGeometry.columnOffsets.at(-1)!;
      const scaleY = layerRect.height / currentGeometry.rowOffsets.at(-1)!;
      if (scaleX <= 0 || scaleY <= 0) { cancel(); return; }
      const left = viewport.left + scroller!.clientLeft * scaleX, top = viewport.top + scroller!.clientTop * scaleY;
      // Sticky row/column headers are outside the sheet body drop area.
      const delta = getDragScrollDelta({ x: session.pointer.clientX, y: session.pointer.clientY }, {
        left: left + currentGeometry.columnOffsets[0] * scaleX, top: top + currentGeometry.rowOffsets[0] * scaleY,
        right: left + scroller!.clientWidth * scaleX, bottom: top + scroller!.clientHeight * scaleY,
      }, elapsed);
      scroller!.scrollLeft += delta.x / scaleX;
      scroller!.scrollTop += delta.y / scaleY;
      // The layer rectangle includes the new scroll offset. Re-read it instead of
      // adding scroll a second time, so the preview stays under a stationary pointer.
      refresh();
      if (gesture.current === session) frame = view!.requestAnimationFrame(step);
    };
    document?.addEventListener?.("pointerup", pointerUp);
    document?.addEventListener?.("pointercancel", pointerCancel);
    document?.addEventListener?.("keydown", escape);
    view?.addEventListener?.("blur", cancel);
    scroller?.addEventListener("scroll", refresh, { passive: true });
    tracking.current = {
      resume() {
        if (session.kind !== "rotate" && scroller && view?.requestAnimationFrame && frame === undefined && gesture.current === session)
          frame = view.requestAnimationFrame(step);
      },
      dispose() {
        if (frame !== undefined) view?.cancelAnimationFrame(frame);
        document?.removeEventListener?.("pointerup", pointerUp);
        document?.removeEventListener?.("pointercancel", pointerCancel);
        document?.removeEventListener?.("keydown", escape);
        view?.removeEventListener?.("blur", cancel);
        scroller?.removeEventListener("scroll", refresh);
      },
    };
  }
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
  useLayoutEffect(() => { if (gesture.current && !eligible(gesture.current)) cancelGesture(); });
  useLayoutEffect(() => () => stopGesture(false), []);
  return { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown, rotateKeyDown };
}
