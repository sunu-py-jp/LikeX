"use client";

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { MIN_ZOOM, MAX_ZOOM, zoomAtSliderPosition, zoomSliderPosition } from "../state/use-spreadsheet-zoom";

export function SpreadsheetZoomControls({ controller: c }: { controller: SpreadsheetController }) {
  if (!c.features.zoom) return null;
  return <div className="lxs-zoom-controls" role="group" aria-label="表示倍率">
    <button type="button" aria-label="縮小" title="縮小" disabled={c.zoom <= MIN_ZOOM} onClick={() => c.setZoom(c.zoom - 5)}>−</button>
    <span className="lxs-zoom-slider">
      <input type="range" aria-label="表示倍率" aria-valuetext={`${c.zoom}%`} min={0} max={100} step={1}
        value={zoomSliderPosition(c.zoom)} onChange={event => c.setZoom(zoomAtSliderPosition(Number(event.target.value)))} />
    </span>
    <button type="button" aria-label="拡大" title="拡大" disabled={c.zoom >= MAX_ZOOM} onClick={() => c.setZoom(c.zoom + 5)}>＋</button>
    <button type="button" className="lxs-zoom-percent" aria-label={`表示倍率 ${c.zoom}%。100%に戻す`} title="100%に戻す" onClick={() => c.setZoom(100)}>{c.zoom}%</button>
  </div>;
}
