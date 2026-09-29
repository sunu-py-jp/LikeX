"use client";

import { useId, type RefObject } from "react";
import { getConnectorPortPoints, type ConnectorPoint } from "../../core";
import type { SpreadsheetShapeDrawing, SpreadsheetSheet } from "../../model/types";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import type { DrawingGeometry } from "../../state/drawing-geometry";
import { drawingLabel } from "./drawing-helpers";
import { DrawingTextEditor } from "./drawing-content";
import { LineMarker } from "./line-marker";
import { useLineInteractions } from "./use-line-interactions";

/** Lines own only their stroke hit area and two endpoints, never a rectangular resize frame. */
export function SpreadsheetLineDrawing({ drawing, sheet, controller: c, geometry, grid, layer, editing, onEditText, onDone }: {
  drawing: SpreadsheetShapeDrawing; sheet: SpreadsheetSheet; controller: SpreadsheetController;
  geometry: DrawingGeometry; grid: { columns: readonly number[]; rows: readonly number[] }; layer: RefObject<HTMLDivElement | null>; editing?: boolean; onEditText: () => void; onDone: () => void;
}) {
  const marker = useId().replace(/:/g, ""), selected = c.selectedDrawingId === drawing.id;
  const { drag, points, targets, begin, moved, finish, key, stop, lostCapture } = useLineInteractions(c, drawing, sheet, geometry, grid, layer, onEditText);
  const display = (point: ConnectorPoint) => ({ x: point.x + geometry.columnOffsets[0], y: point.y + geometry.rowOffsets[0] });
  const start = display(points.start), end = display(points.end);
  const startArrow = drawing.startArrow ?? "none", endArrow = drawing.endArrow ?? (drawing.shape === "arrow" ? "triangle" : "none");
  return <div data-lxs-drawing={drawing.id} role="group" aria-label={drawingLabel(drawing)} aria-roledescription="線" tabIndex={0}
    className={`lxs-line-drawing ${selected ? "lxs-line-selected" : ""}`} onFocus={() => c.selectDrawing(drawing.id)}
    onDoubleClick={() => { if (!c.disabled && !c.requesting) onEditText(); }}
    onPointerDown={event => begin(event, "move")} onPointerMove={moved} onPointerUp={finish} onPointerCancel={() => stop()}
    onLostPointerCapture={lostCapture} onKeyDown={event => key(event)}>
    <svg width={geometry.columnOffsets.at(-1)} height={geometry.rowOffsets.at(-1)} overflow="visible" aria-hidden="true">
      <defs><LineMarker id={`${marker}-start`} kind={startArrow} color={drawing.stroke} /><LineMarker id={`${marker}-end`} kind={endArrow} color={drawing.stroke} /></defs>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={drawing.stroke} strokeWidth={drawing.strokeWidth} strokeLinecap="round"
        markerStart={startArrow !== "none" ? `url(#${marker}-start)` : undefined} markerEnd={endArrow !== "none" ? `url(#${marker}-end)` : undefined} />
      <line data-lxs-line-hit="true" x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeLinecap="round" strokeWidth={Math.max(12 / (c.zoom / 100), drawing.strokeWidth)} style={{ pointerEvents: "stroke", cursor: c.disabled ? "default" : "move" }} />
      {!!drawing.text && <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2} textAnchor="middle" fill={drawing.color ?? "#1f2937"} fontSize={drawing.fontSize ?? 16} fontWeight={drawing.bold ? "bold" : undefined}>{drawing.text}</text>}
      {drag && drag.kind !== "move" && targets.filter(target => target.id === drag.nearbyTarget).flatMap(target => getConnectorPortPoints(target.box, target.outline).map(({ port, point }) => {
        const p = display(point), attached = points[drag.kind as "start" | "end"].binding;
        return <circle key={`${target.id}:${port}`} data-lxs-connection-port={`${target.id}:${port}`} cx={p.x} cy={p.y} r={attached?.targetId === target.id && attached.port === port ? 5 : 3}
          fill={attached?.targetId === target.id && attached.port === port ? "var(--lxs-accent)" : "var(--lxs-background)"} stroke="var(--lxs-accent)" />;
      }))}
    </svg>
    {editing && selected && !c.disabled && <div className="lxs-line-text-editor" style={{ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.max(120, Math.abs(end.x - start.x)), height: Math.max(60, Math.abs(end.y - start.y)) }}>
      <DrawingTextEditor drawing={drawing} controller={c} onDone={onDone} />
    </div>}
    {selected && !c.disabled && !c.requesting && c.features.resize && (["start", "end"] as const).map(endpoint => {
      const p = display(points[endpoint]);
      return <button key={endpoint} type="button" className="lxs-line-endpoint" aria-label={`${drawingLabel(drawing)}の${endpoint === "start" ? "始点" : "終点"}`} title="ドラッグで接続点へ接続。離すと接続を解除"
        style={{ left: p.x, top: p.y }} onPointerDown={event => begin(event, endpoint)} onKeyDown={event => key(event, endpoint)} />;
    })}
  </div>;
}
