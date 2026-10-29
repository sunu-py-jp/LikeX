"use client";

/* The copyable component displays validated local data URLs without Next.js. */
/* eslint-disable @next/next/no-img-element */

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { memo, useLayoutEffect, useMemo } from "react";
import { isOtherTextControl } from "../state/clipboard/browser-clipboard";
import { drawingRectangle, type DrawingGeometry, type DrawingResizeCorner } from "../state/drawing-geometry";
import { drawingResizeCursor } from "../state/drawing-rotation";
import { drawingLabel, visibleDrawing } from "./drawings/drawing-helpers";
import { Shape, DrawingText, DrawingTextEditor } from "./drawings/drawing-content";
import { useDrawingInteractions } from "./drawings/use-drawing-interactions";
import { isSpreadsheetLine } from "../model/lines";
import { SpreadsheetLineDrawing } from "./drawings/spreadsheet-line";
import { drawingAnchor } from "../state/drawing-geometry";
import { drawingBoundsIntersectViewport, drawingViewportBounds, type DrawingViewport } from "./drawings/drawing-viewport";

import { cornerAdjustmentPosition } from "./drawings/corner-adjustment";

export { visibleDrawing } from "./drawings/drawing-helpers";
export { SpreadsheetDrawingInspector } from "./drawings/drawing-inspector";

const corners: { corner: DrawingResizeCorner; label: string }[] = [
  { corner: "nw", label: "左上" }, { corner: "ne", label: "右上" }, { corner: "sw", label: "左下" }, { corner: "se", label: "右下" },
];

/** Presents drawing content and composes the interaction handlers for each object. */
export const SpreadsheetDrawings = memo(function SpreadsheetDrawings({ controller: c, geometry, viewport }: { controller: SpreadsheetController; geometry: DrawingGeometry; viewport?: DrawingViewport }) {
  const { layer, preview, editingText, setEditingText, start, move, finish, cancelGesture, lostPointerCapture, keyDown, resizeKeyDown, rotateKeyDown, cornerRadiusKeyDown } = useDrawingInteractions(c, geometry);
  useLayoutEffect(() => {
    const element = layer.current, selectedId = c.selectedDrawingId;
    if (!element || !selectedId || c.selectionFocus === false) return;
    const active = element.ownerDocument?.activeElement;
    // Pasting selects a new object. Move keyboard focus with it, without taking
    // focus from a text/property editor or a different component on the page.
    if (!active || isOtherTextControl(active) || !element.closest?.("[data-likex-spreadsheet]")?.contains(active)) return;
    Array.from(element.querySelectorAll<HTMLElement>("[data-lxs-drawing]"))
      .find(drawing => drawing.dataset.lxsDrawing === selectedId)?.focus({ preventScroll: true });
  }, [c.selectedDrawingId, c.selectionFocus, layer]);
  const lineGrid = useMemo(() => ({ columns: geometry.columnOffsets.map(value => value - geometry.columnOffsets[0]), rows: geometry.rowOffsets.map(value => value - geometry.rowOffsets[0]) }), [geometry]);
  const displayedSheet = useMemo(() => preview && preview.workbook === c.workbook && !c.disabled ? { ...c.activeSheet,
    drawings: c.activeSheet.drawings?.map(drawing => drawing.id === preview.id ? { ...drawing,
      anchor: drawingAnchor(preview.preview.left, preview.preview.top, geometry), width: preview.preview.width, height: preview.preview.height,
      ...(preview.kind === "cornerRadius" ? { cornerRadiusRatio: preview.preview.cornerRadiusRatio } : {}),
      rotation: preview.preview.rotation, flipX: preview.preview.flipX, flipY: preview.preview.flipY } : drawing) } : c.activeSheet,
    [preview, c.workbook, c.disabled, c.activeSheet, geometry]);
  const culling = c.renderingMode === "viewport" && !!viewport;
  // Scrolling only tests cached rectangles; resolving every connected line on
  // each scroll event would repeatedly scan the complete drawing collection.
  const bounds = useMemo(() => culling ? new Map((displayedSheet.drawings ?? []).map(drawing =>
    [drawing.id, drawingViewportBounds(drawing, displayedSheet, geometry, lineGrid)])) : null, [culling, displayedSheet, geometry, lineGrid]);
  const currentDrawings = (c.activeSheet.drawings ?? []).filter(drawing => !c.filters?.hiddenRows.has(drawing.anchor.row) && visibleDrawing(drawing, c) &&
    (!bounds || !viewport || drawing.id === c.selectedDrawingId || drawing.id === editingText || drawing.id === preview?.id ||
      drawingBoundsIntersectViewport(bounds.get(drawing.id)!, viewport)));
  return <div ref={layer} className="lxs-drawing-layer" role="group" aria-label="シート上のオブジェクト">
    {currentDrawings.map(drawing => {
      if (isSpreadsheetLine(drawing)) return <SpreadsheetLineDrawing key={drawing.id} drawing={drawing} sheet={displayedSheet} controller={c} geometry={geometry} grid={lineGrid} layer={layer} editing={editingText === drawing.id} onEditText={() => setEditingText(drawing.id)} onDone={() => setEditingText(null)} />;
      const currentPreview = preview?.id === drawing.id && preview.workbook === c.workbook && !c.disabled && (preview.kind === "move" || c.features.resize) ? preview : null;
      const rectangle = currentPreview?.preview ?? drawingRectangle(drawing, geometry);
      const flipX = currentPreview?.preview.flipX ?? !!drawing.flipX, flipY = currentPreview?.preview.flipY ?? !!drawing.flipY;
      const rotation = currentPreview?.preview.rotation ?? drawing.rotation ?? 0;
      const reverseCursor = currentPreview && (flipX !== currentPreview.initial.flipX) !== (flipY !== currentPreview.initial.flipY);
      const selected = c.selectedDrawingId === drawing.id;
      const resource = drawing.type === "image" ? c.workbook.resources?.images?.[drawing.resourceId] : undefined;
      // Keep the immutable model reference while selecting cells/objects or
      // moving/rotating an object. Cloning every drawing here restarts each
      // shrink-to-fit text measurement (and its synchronous browser layouts).
      const visualChanged = rectangle.width !== drawing.width || rectangle.height !== drawing.height ||
        flipX !== !!drawing.flipX || flipY !== !!drawing.flipY ||
        currentPreview?.kind === "cornerRadius" && currentPreview.preview.cornerRadiusRatio !== (drawing.type === "shape" ? drawing.cornerRadiusRatio : undefined);
      const displayedDrawing = visualChanged ? { ...drawing, width: rectangle.width, height: rectangle.height, flipX, flipY,
        ...(currentPreview?.kind === "cornerRadius" ? { cornerRadiusRatio: currentPreview.preview.cornerRadiusRatio } : {}) } : drawing;
      return <div key={drawing.id} data-lxs-drawing={drawing.id} role="group" aria-label={drawingLabel(drawing)} aria-roledescription={drawing.type === "image" ? "画像" : drawing.type === "text" ? "テキストボックス" : "図形"} tabIndex={0}
        className={`lxs-drawing ${selected ? "lxs-drawing-selected" : ""} ${c.disabled ? "lxs-drawing-readonly" : ""}`}
        style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height,
          ...(rotation ? { transform: `rotate(${rotation}deg)`, transformOrigin: "center" } : {}) }}
        onFocus={() => c.selectDrawing(drawing.id)} onPointerDown={event => start(event, drawing, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={() => lostPointerCapture(drawing.id)} onKeyDown={event => keyDown(event, drawing)}
        onDoubleClick={() => { if (drawing.type !== "image" && !c.disabled) setEditingText(drawing.id); }}>
        {drawing.type === "image" ? resource ? <img src={resource.dataUrl} alt={drawing.alt} draggable={false} decoding="async" style={{ objectFit: drawing.fit ?? "contain", transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }} /> : <span className="lxs-image-missing">画像を表示できません</span>
          : <>
            {displayedDrawing.type === "shape" && <Shape drawing={displayedDrawing} />}
            {editingText === drawing.id && selected && !c.disabled ? <DrawingTextEditor key={drawing.id} drawing={drawing} controller={c} onDone={() => setEditingText(null)} />
              : displayedDrawing.type !== "image" && <DrawingText drawing={displayedDrawing} parentRotation={displayedDrawing.textUpright ? rotation : undefined} />}
          </>}
        {selected && !c.disabled && c.features.resize && corners.map(({ corner, label }) => <button key={corner} type="button" className="lxs-drawing-resize" data-lxs-resize-corner={corner}
          aria-label={`${drawingLabel(drawing)}のサイズを変更（${label}）`} title={`${label}をドラッグまたは矢印キーでサイズを変更`}
          style={{ cursor: drawingResizeCursor(corner, rotation, !!reverseCursor && currentPreview?.corner === corner) }}
          onPointerDown={event => start(event, drawing, "resize", corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onKeyDown={event => resizeKeyDown(event, drawing, corner)} />)}
        {selected && !c.disabled && c.features.resize && displayedDrawing.type === "shape" && displayedDrawing.shape === "roundedRectangle" && <button type="button" role="slider" className="lxs-drawing-corner-adjust"
          aria-label={`${drawingLabel(drawing)}の角の丸み`} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round((displayedDrawing.cornerRadiusRatio ?? 0.16667) * 200)}
          aria-valuetext={`${Math.round((displayedDrawing.cornerRadiusRatio ?? 0.16667) * 200)}%`} aria-orientation="horizontal"
          title="黄色の点をドラッグして角の丸みを調整（0〜100%）。矢印キーで1%、Shiftで10%、Homeで0%、Endで100%"
          style={cornerAdjustmentPosition(displayedDrawing)}
          onPointerDown={event => start(event, drawing, "cornerRadius")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onDoubleClick={event => event.stopPropagation()} onKeyDown={event => cornerRadiusKeyDown(event, drawing)} />}
        {selected && !c.disabled && c.features.resize && <button type="button" className="lxs-drawing-rotate"
          aria-label={`${drawingLabel(drawing)}を回転`} title="ドラッグで回転（Shiftで15度単位）。矢印キーで1度、Shiftで15度、Homeで0度"
          onPointerDown={event => start(event, drawing, "rotate")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
          onKeyDown={event => rotateKeyDown(event, drawing)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 7v6h-6M19 12a7 7 0 1 0-2 5M20 13l-3-4" /></svg></button>}
      </div>;
    })}
  </div>;
});
