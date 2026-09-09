"use client";

/* The copyable component displays validated local data URLs without Next.js. */
/* eslint-disable @next/next/no-img-element */

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { drawingRectangle, type DrawingGeometry } from "../state/drawing-geometry";
import { drawingLabel, visibleDrawing } from "./drawings/drawing-helpers";
import { Shape, DrawingTextEditor } from "./drawings/drawing-content";
import { useDrawingInteractions } from "./drawings/use-drawing-interactions";

export { visibleDrawing } from "./drawings/drawing-helpers";
export { SpreadsheetDrawingInspector } from "./drawings/drawing-inspector";

/** Presents drawing content and composes the interaction handlers for each object. */
export function SpreadsheetDrawings({ controller: c, geometry }: { controller: SpreadsheetController; geometry: DrawingGeometry }) {
  const { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown } = useDrawingInteractions(c, geometry);
  const currentDrawings = (c.activeSheet.drawings ?? []).filter(drawing => visibleDrawing(drawing, c));
  return <div ref={layer} className="lxs-drawing-layer" role="group" aria-label="シート上のオブジェクト" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}>
    {currentDrawings.map(drawing => {
      const rectangle = preview?.id === drawing.id && preview.workbook === c.workbook && !c.disabled ? preview.preview : drawingRectangle(drawing, geometry);
      const selected = c.selectedDrawingId === drawing.id;
      const resource = drawing.type === "image" ? c.workbook.resources?.images?.[drawing.resourceId] : undefined;
      return <div key={drawing.id} data-lxs-drawing={drawing.id} role="group" aria-label={drawingLabel(drawing)} aria-roledescription={drawing.type === "image" ? "画像" : drawing.type === "text" ? "テキストボックス" : "図形"} tabIndex={0}
        className={`lxs-drawing ${selected ? "lxs-drawing-selected" : ""} ${c.disabled ? "lxs-drawing-readonly" : ""}`}
        style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height }}
        onFocus={() => c.selectDrawing(drawing.id)} onPointerDown={event => start(event, drawing, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={() => lostPointerCapture(drawing.id)} onKeyDown={event => keyDown(event, drawing)}
        onDoubleClick={() => { if (drawing.type === "text" && !c.disabled) setEditingText(drawing.id); }}>
        {drawing.type === "image" ? resource ? <img src={resource.dataUrl} alt={drawing.alt} draggable={false} decoding="async" /> : <span className="lxs-image-missing">画像を表示できません</span>
          : drawing.type === "shape" ? <Shape drawing={{ ...drawing, width: rectangle.width, height: rectangle.height }} />
            : editingText === drawing.id && selected && !c.disabled ? <DrawingTextEditor key={drawing.id} drawing={drawing} controller={c} onDone={() => setEditingText(null)} />
              : <div className="lxs-text-box" style={{ fontSize: drawing.fontSize, color: drawing.color, background: drawing.background, fontWeight: drawing.bold ? 700 : 400 }}>{drawing.text || "テキストを入力"}</div>}
        {selected && !c.disabled && c.features.resize && <button type="button" className="lxs-drawing-resize" aria-label={`${drawingLabel(drawing)}のサイズを変更`} title="ドラッグまたは矢印キーでサイズを変更" onPointerDown={event => start(event, drawing, "resize")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onKeyDown={event => resizeKeyDown(event, drawing)} />}
      </div>;
    })}
  </div>;
}
