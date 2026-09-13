"use client";

/* The copyable component displays validated local data URLs without Next.js. */
/* eslint-disable @next/next/no-img-element */

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { useLayoutEffect } from "react";
import { isOtherTextControl } from "../state/clipboard/browser-clipboard";
import { drawingRectangle, type DrawingGeometry, type DrawingResizeCorner } from "../state/drawing-geometry";
import { drawingLabel, visibleDrawing } from "./drawings/drawing-helpers";
import { Shape, DrawingText, DrawingTextEditor } from "./drawings/drawing-content";
import { useDrawingInteractions } from "./drawings/use-drawing-interactions";

export { visibleDrawing } from "./drawings/drawing-helpers";
export { SpreadsheetDrawingInspector } from "./drawings/drawing-inspector";

const corners: { corner: DrawingResizeCorner; label: string }[] = [
  { corner: "nw", label: "左上" }, { corner: "ne", label: "右上" }, { corner: "sw", label: "左下" }, { corner: "se", label: "右下" },
];

/** Presents drawing content and composes the interaction handlers for each object. */
export function SpreadsheetDrawings({ controller: c, geometry }: { controller: SpreadsheetController; geometry: DrawingGeometry }) {
  const { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown } = useDrawingInteractions(c, geometry);
  useLayoutEffect(() => {
    const element = layer.current, selectedId = c.selectedDrawingId;
    if (!element || !selectedId) return;
    const active = element.ownerDocument?.activeElement;
    // Pasting selects a new object. Move keyboard focus with it, without taking
    // focus from a text/property editor or a different component on the page.
    if (!active || isOtherTextControl(active) || !element.closest?.("[data-likex-spreadsheet]")?.contains(active)) return;
    Array.from(element.querySelectorAll<HTMLElement>("[data-lxs-drawing]"))
      .find(drawing => drawing.dataset.lxsDrawing === selectedId)?.focus({ preventScroll: true });
  }, [c.selectedDrawingId, layer]);
  const currentDrawings = (c.activeSheet.drawings ?? []).filter(drawing => visibleDrawing(drawing, c));
  return <div ref={layer} className="lxs-drawing-layer" role="group" aria-label="シート上のオブジェクト">
    {currentDrawings.map(drawing => {
      const currentPreview = preview?.id === drawing.id && preview.workbook === c.workbook && !c.disabled && (preview.kind !== "resize" || c.features.resize) ? preview : null;
      const rectangle = currentPreview?.preview ?? drawingRectangle(drawing, geometry);
      const flipX = currentPreview?.preview.flipX ?? !!drawing.flipX, flipY = currentPreview?.preview.flipY ?? !!drawing.flipY;
      const reverseCursor = currentPreview && (flipX !== currentPreview.initial.flipX) !== (flipY !== currentPreview.initial.flipY);
      const selected = c.selectedDrawingId === drawing.id;
      const resource = drawing.type === "image" ? c.workbook.resources?.images?.[drawing.resourceId] : undefined;
      return <div key={drawing.id} data-lxs-drawing={drawing.id} role="group" aria-label={drawingLabel(drawing)} aria-roledescription={drawing.type === "image" ? "画像" : drawing.type === "text" ? "テキストボックス" : "図形"} tabIndex={0}
        className={`lxs-drawing ${selected ? "lxs-drawing-selected" : ""} ${c.disabled ? "lxs-drawing-readonly" : ""}`}
        style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height }}
        onFocus={() => c.selectDrawing(drawing.id)} onPointerDown={event => start(event, drawing, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={() => lostPointerCapture(drawing.id)} onKeyDown={event => keyDown(event, drawing)}
        onDoubleClick={() => { if (drawing.type !== "image" && !c.disabled) setEditingText(drawing.id); }}>
        {drawing.type === "image" ? resource ? <img src={resource.dataUrl} alt={drawing.alt} draggable={false} decoding="async" style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }} /> : <span className="lxs-image-missing">画像を表示できません</span>
          : <>
            {drawing.type === "shape" && <Shape drawing={{ ...drawing, width: rectangle.width, height: rectangle.height, flipX, flipY }} />}
            {editingText === drawing.id && selected && !c.disabled ? <DrawingTextEditor key={drawing.id} drawing={drawing} controller={c} onDone={() => setEditingText(null)} />
              : <DrawingText drawing={drawing} />}
          </>}
        {selected && !c.disabled && c.features.resize && corners.map(({ corner, label }) => <button key={corner} type="button" className="lxs-drawing-resize" data-lxs-resize-corner={corner}
          aria-label={`${drawingLabel(drawing)}のサイズを変更（${label}）`} title={`${label}をドラッグまたは矢印キーでサイズを変更`}
          style={reverseCursor && currentPreview?.corner === corner ? { cursor: corner === "nw" || corner === "se" ? "nesw-resize" : "nwse-resize" } : undefined}
          onPointerDown={event => start(event, drawing, "resize", corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onKeyDown={event => resizeKeyDown(event, drawing, corner)} />)}
      </div>;
    })}
  </div>;
}
