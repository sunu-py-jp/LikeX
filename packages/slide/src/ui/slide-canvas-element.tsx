import type { MouseEvent, PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { connectorWorldToLocal } from "../core";
import { getSlideLineEndpoints, isSlideLine } from "../model/lines";
import type { SlideElement } from "../model/types";
import { getSlideShapeGeometry } from "../render/render-style";
import { elementStyle, SlideElementContent } from "./slide-artwork";

type Corner = "nw" | "ne" | "sw" | "se";
type GestureKind = "move" | "resize" | "rotate" | "start" | "end" | "corner";

/** Pure artwork and controls; gesture refs stay in the canvas event handlers. */
export function SlideCanvasElement({ element, elements = [], original, selected, editable, formatting, textEnabled, moving, scale, onBegin, onMenu, onEdit, onCornerChange }: {
  element: SlideElement; elements?: readonly SlideElement[]; original: SlideElement; selected: boolean; editable: boolean; formatting: boolean;
  textEnabled: boolean; moving: boolean; scale: number;
  onBegin(event: PointerEvent<HTMLElement>, element: SlideElement, kind: GestureKind, corner?: Corner): void;
  onMenu(event: MouseEvent<HTMLElement>, element: SlideElement): void;
  onEdit(editing: { id: string; text: string }): void;
  onCornerChange(element: SlideElement, ratio: number): void;
}) {
  const line = isSlideLine(element);
  const geometry = line ? getSlideShapeGeometry(element, elements) : null;
  return <div className={`lxp-element lxp-canvas-element${line ? " lxp-line-element" : ""}${selected ? " lxp-element-selected" : ""}`}
    data-slide-element={element.id} role="button" tabIndex={-1} aria-label={element.name || `${element.type} オブジェクト`} aria-pressed={selected}
    style={{ ...elementStyle(element), ...(moving ? { opacity: element.opacity * .62 } : {}) }} onPointerDown={event => onBegin(event, original, "move")}
    onContextMenu={event => onMenu(event, original)}
    onDoubleClick={() => { if (editable && textEnabled && element.type !== "image" && !element.locked) onEdit({ id: element.id, text: element.text }); }}>
    <SlideElementContent element={element} elements={elements} />
    {element.type === "text" && element.layoutPlaceholderId && !element.text && editable && textEnabled && <div className="lxp-placeholder-hint" aria-hidden="true" style={{ fontSize: Math.min(element.fontSize, 28) }}>ダブルクリックして{element.name || "テキスト"}を入力</div>}
    {line && geometry?.kind === "line" && <svg className="lxp-line-hit" width={element.width} height={element.height} style={{ overflow: "visible" }} aria-hidden="true">
      <line x1={geometry.x1} y1={geometry.y1} x2={geometry.x2} y2={geometry.y2} stroke="transparent" strokeWidth={Math.max(element.strokeWidth, 12 / scale)} strokeLinecap="round" style={{ pointerEvents: "stroke" }} />
    </svg>}
    {line && geometry?.kind === "polyline" && <svg className="lxp-line-hit" width={element.width} height={element.height} style={{ overflow: "visible" }} aria-hidden="true">
      <polyline points={geometry.points.map(point => point.join(",")).join(" ")} fill="none" stroke="transparent" strokeWidth={Math.max(element.strokeWidth, 12 / scale)} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "stroke" }} />
    </svg>}
    {selected && editable && formatting && !element.locked && <>
      {line ? (["start", "end"] as const).map(end => {
        const point = connectorWorldToLocal(getSlideLineEndpoints(element)[end], element);
        return <button key={end} type="button" className="lxp-line-handle" aria-label={`${element.name}の${end === "start" ? "始点" : "終点"}`} style={{ left: point.x, top: point.y, width: 10 / scale, height: 10 / scale }} onPointerDown={event => onBegin(event, original, end)} />;
      }) : <>{(["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button" className={`lxp-resize-handle lxp-resize-${corner}`}
        aria-label={`${element.name}の${{ nw: "左上", ne: "右上", sw: "左下", se: "右下" }[corner]}を変形`}
        style={{ width: 8 / scale, height: 8 / scale }} onPointerDown={event => onBegin(event, original, "resize", corner)} />)}
      {element.type === "shape" && element.shape === "roundRect" && <button type="button" role="slider" className="lxp-corner-handle"
        aria-label={`${element.name || "角丸長方形"}の角の丸み`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round((element.cornerRadiusRatio ?? .12) * 200)} aria-valuetext={`${Math.round((element.cornerRadiusRatio ?? .12) * 200)}%`}
        aria-orientation="horizontal" title="角の丸みを調整"
        style={{ left: Math.min(element.width, element.height) * (element.cornerRadiusRatio ?? .12), top: 0, width: 12 / scale, height: 12 / scale }}
        onPointerDown={event => onBegin(event, original, "corner")}
        onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? .05 : .005;
          const ratio = event.key === "Home" ? 0 : event.key === "End" ? .5
            : (element.cornerRadiusRatio ?? .12) + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step);
          onCornerChange(original, Math.max(0, Math.min(.5, ratio)));
        }} />}
      <button type="button" className="lxp-rotate-handle" aria-label={`${element.name}を回転`}
        style={{ width: 20 / scale, height: 20 / scale, top: -30 / scale }} onPointerDown={event => onBegin(event, original, "rotate")}><RotateCw style={{ width: 13 / scale, height: 13 / scale }} /></button></>}
    </>}
  </div>;
}
