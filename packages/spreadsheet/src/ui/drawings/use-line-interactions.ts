import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent, type RefObject } from "react";
import { findNearestConnectorPort, type ConnectorEndpoint, type ConnectorPoint } from "../../core";
import { getSpreadsheetLinePoints, isSpreadsheetLine, spreadsheetDrawingBox, spreadsheetDrawingOutline } from "../../model/lines";
import type { SpreadsheetLinePoints, SpreadsheetShapeDrawing, SpreadsheetSheet } from "../../model/types";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import type { DrawingGeometry } from "../../state/drawing-geometry";
import { visibleDrawing } from "./drawing-helpers";
import { blurObjectEditor } from "../../state/blur-object-editor";

type Endpoint = "start" | "end";
type Drag = { kind: Endpoint | "move"; start: ConnectorPoint; initial: SpreadsheetLinePoints; points: SpreadsheetLinePoints;
  workbook: SpreadsheetController["workbook"]; drawing: SpreadsheetShapeDrawing; sheetId: string; zoom: number; pointerId: number; target: HTMLElement; nearbyTarget?: string };

export function useLineInteractions(c: SpreadsheetController, drawing: SpreadsheetShapeDrawing, sheet: SpreadsheetSheet,
  geometry: DrawingGeometry, grid: { columns: readonly number[]; rows: readonly number[] }, layer: RefObject<HTMLDivElement | null>, onEditText: () => void) {
  const latest = useRef(c), active = useRef<Drag | null>(null), mounted = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  useLayoutEffect(() => { latest.current = c; });
  const resolvedPoints = useMemo(() => getSpreadsheetLinePoints(sheet, drawing.id, grid), [sheet, drawing.id, grid]);
  const points = drag?.points ?? resolvedPoints;
  const endpointDrag = !!drag && drag.kind !== "move";
  const targets = useMemo(() => endpointDrag ? (sheet.drawings ?? []).filter(item => !isSpreadsheetLine(item) && visibleDrawing(item, { features: c.features } as SpreadsheetController))
    .map(item => ({ id: item.id, box: spreadsheetDrawingBox(sheet, item, grid), outline: spreadsheetDrawingOutline(item) })) : [], [endpointDrag, sheet, c.features, grid]);
  const current = (session: Drag) => mounted.current && latest.current.getWorkbook() === session.workbook &&
    latest.current.activeSheet.id === session.sheetId && latest.current.selectedDrawingId === drawing.id &&
    !latest.current.disabled && !latest.current.pendingObjectEdit && !latest.current.editing && latest.current.features.shapes &&
    (session.kind === "move" || latest.current.features.resize) && (latest.current.zoom ?? 100) === session.zoom;
  const stop = (render = true) => {
    const session = active.current; active.current = null;
    if (render && mounted.current) setDrag(null);
    try { if (session?.target.hasPointerCapture?.(session.pointerId)) session.target.releasePointerCapture(session.pointerId); } catch { /* Detached node. */ }
  };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(false); }; }, []);
  useLayoutEffect(() => { if (active.current && !current(active.current)) stop(); });
  const pointer = (event: { clientX: number; clientY: number }): ConnectorPoint => {
    const rect = layer.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (rect.width ? geometry.columnOffsets.at(-1)! / rect.width : 1) - geometry.columnOffsets[0],
      y: (event.clientY - rect.top) * (rect.height ? geometry.rowOffsets.at(-1)! / rect.height : 1) - geometry.rowOffsets[0] };
  };
  const begin = (event: PointerEvent<HTMLElement>, kind: Drag["kind"]) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); blurObjectEditor(event.currentTarget);
    const target = event.currentTarget;
    let synchronous = true;
    c.afterCommit(() => {
      c.selectDrawing(drawing.id); target.focus({ preventScroll: true });
      if (!synchronous || c.disabled || c.requesting || c.pendingObjectEdit || !c.features.shapes || (kind !== "move" && !c.features.resize)) return;
      const initial = getSpreadsheetLinePoints(c.activeSheet, drawing.id, grid);
      const session: Drag = { kind, start: pointer(event), initial, points: initial, workbook: c.getWorkbook(), sheetId: c.activeSheet.id,
        drawing, zoom: c.zoom ?? 100, pointerId: event.pointerId, target };
      target.setPointerCapture?.(event.pointerId); active.current = session; setDrag({ ...session });
    });
    synchronous = false;
  };
  const moved = (event: { clientX: number; clientY: number; pointerId: number }) => {
    const session = active.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!current(session) || !layer.current) { stop(); return; }
    const point = pointer(event);
    if (session.kind === "move") {
      const dx = Math.max(-Math.min(session.initial.start.x, session.initial.end.x), point.x - session.start.x);
      const dy = Math.max(-Math.min(session.initial.start.y, session.initial.end.y), point.y - session.start.y);
      const shift = (endpoint: ConnectorEndpoint) => ({ x: endpoint.x + dx, y: endpoint.y + dy });
      session.points = dx || dy ? { start: shift(session.initial.start), end: shift(session.initial.end) } : session.initial;
    } else {
      const nearby = findNearestConnectorPort(point, targets, 32 / (c.zoom / 100));
      session.nearbyTarget = nearby?.binding.targetId;
      const snapped = nearby && nearby.distance <= 12 / (c.zoom / 100) ? nearby : undefined;
      session.points = { ...session.initial, [session.kind]: snapped ? { ...snapped.point, binding: snapped.binding }
        : { x: Math.max(0, point.x), y: Math.max(0, point.y) } };
    }
    setDrag({ ...session });
  };
  const commit = (next: SpreadsheetLinePoints, isCurrent?: () => boolean) => c.executeCommands([
    { type: "lines.update", sheetId: c.activeSheet.id, drawingId: drawing.id, ...next },
  ], { isCurrent });
  const finish = (event: { clientX: number; clientY: number; pointerId: number }) => {
    moved(event);
    const session = active.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const valid = current(session);
    stop();
    if (valid && JSON.stringify(session.points) !== JSON.stringify(session.initial)) void commit(session.points, () => current(session));
  };
  const handlers = useRef({ finish, stop });
  useLayoutEffect(() => { handlers.current = { finish, stop }; });
  const eventTarget = drag?.target;
  useLayoutEffect(() => {
    if (!eventTarget) return;
    const doc = eventTarget.ownerDocument, win = doc?.defaultView;
    const up = (event: globalThis.PointerEvent) => handlers.current.finish(event);
    const cancel = () => handlers.current.stop();
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); handlers.current.stop(); } };
    doc?.addEventListener("pointerup", up); doc?.addEventListener("pointercancel", cancel); doc?.addEventListener("keydown", escape);
    win?.addEventListener("blur", cancel);
    return () => { doc?.removeEventListener("pointerup", up); doc?.removeEventListener("pointercancel", cancel); doc?.removeEventListener("keydown", escape); win?.removeEventListener("blur", cancel); };
  }, [eventTarget]);
  const key = (event: KeyboardEvent, endpoint?: Endpoint) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); c.selectDrawing(null); c.requestGridFocus(); return; }
    if (event.key === "Enter" && !c.disabled && !c.requesting) { event.preventDefault(); event.stopPropagation(); onEditText(); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && !c.disabled) {
      event.preventDefault(); event.stopPropagation(); c.afterCommand({ type: "drawings.delete", sheetId: c.activeSheet.id, drawingId: drawing.id }, () => { c.selectDrawing(null); c.requestGridFocus(); }); return;
    }
    const direction: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!direction[event.key] || c.disabled || c.requesting || (endpoint && !c.features.resize)) return;
    event.preventDefault(); event.stopPropagation();
    const [x, y] = direction[event.key], step = event.shiftKey ? 10 : 1, currentPoints = getSpreadsheetLinePoints(c.activeSheet, drawing.id, grid);
    const dx = endpoint ? x * step : Math.max(-Math.min(currentPoints.start.x, currentPoints.end.x), x * step);
    const dy = endpoint ? y * step : Math.max(-Math.min(currentPoints.start.y, currentPoints.end.y), y * step);
    const shift = (p: ConnectorPoint) => ({ x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) });
    const captured = c.getWorkbook(), sheetId = c.activeSheet.id;
    const next = endpoint ? { ...currentPoints, [endpoint]: shift(currentPoints[endpoint]) }
      : dx || dy ? { start: shift(currentPoints.start), end: shift(currentPoints.end) } : currentPoints;
    void commit(next, () => mounted.current && latest.current.getWorkbook() === captured && latest.current.activeSheet.id === sheetId &&
      latest.current.selectedDrawingId === drawing.id && !latest.current.disabled && !latest.current.pendingObjectEdit && latest.current.features.shapes && (!endpoint || latest.current.features.resize));
  };
  return { drag, points, targets, begin, moved, finish, key, stop, lostCapture: () => { if (active.current) stop(); } };
}
