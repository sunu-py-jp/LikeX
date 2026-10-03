import type { MouseEvent, PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { connectorWorldToLocal } from "../core";
import { getSlideLineEndpoints, isSlideLine } from "../model/lines";
import type { SlideElement } from "../model/types";
import { getSlideShapeGeometry } from "../render/render-style";
import { elementStyle, SlideElementContent } from "./slide-artwork";

type Corner = "nw" | "ne" | "sw" | "se";
type GestureKind = "move" | "resize" | "rotate" | "start" | "end";

/** Pure artwork and controls; gesture refs stay in the canvas event handlers. */
export function SlideCanvasElement({ element, elements = [], original, selected, editable, formatting, textEnabled, moving, scale, onBegin, onMenu, onEdit }: {
  element: SlideElement; elements?: readonly SlideElement[]; original: SlideElement; selected: boolean; editable: boolean; formatting: boolean;
  textEnabled: boolean; moving: boolean; scale: number;
  onBegin(event: PointerEvent<HTMLElement>, element: SlideElement, kind: GestureKind, corner?: Corner): void;
  onMenu(event: MouseEvent<HTMLElement>, element: SlideElement): void;
  onEdit(editing: { id: string; text: string }): void;
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
      <button type="button" className="lxp-rotate-handle" aria-label={`${element.name}を回転`}
        style={{ width: 20 / scale, height: 20 / scale, top: -30 / scale }} onPointerDown={event => onBegin(event, original, "rotate")}><RotateCw style={{ width: 13 / scale, height: 13 / scale }} /></button></>}
    </>}
  </div>;
}
