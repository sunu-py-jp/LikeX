import type { ExplorerViewMode } from "./config";

export const EXPLORER_VIRTUAL_THRESHOLD = 300;
const OVERSCAN = 3;
export type ExplorerListViewport = { width: number; height: number; top: number; left: number; lineHeight: number };
export type ExplorerListLayout = {
  axis: "vertical" | "horizontal";
  columns: number; rows: number; count: number;
  cellWidth: number; rowHeight: number; gapX: number; gapY: number;
  padding: number; header: number; width: number; height: number;
};

/** Fixed row/cell geometry keeps scrolling independent of off-screen DOM. */
export function explorerListLayout(count: number, view: ExplorerViewMode, compact: boolean,
  showLocation: boolean, showCardControls: boolean, viewport: ExplorerListViewport): ExplorerListLayout {
  const width = Math.max(1, viewport.width - 16);
  const line = viewport.lineHeight || 21;
  const smallLine = line * 12 / 14;
  const row = compact ? 28 : 36;
  if (view === "details") {
    const rowHeight = Math.max(row, line + (showLocation ? smallLine : 0) + 8);
    return { axis: "vertical", columns: 1, rows: count, count, cellWidth: width, rowHeight,
      gapX: 0, gapY: 0, padding: 0, header: 32, width, height: count * rowHeight + 32 };
  }
  if (view === "list") {
    const rows = Math.max(1, Math.floor((viewport.height - 20) / row));
    const columns = Math.ceil(count / rows);
    return { axis: "horizontal", rows, columns, count, cellWidth: 230, rowHeight: row,
      gapX: 16, gapY: 0, padding: 8, header: 0,
      width: Math.max(width, columns * 246), height: Math.max(row + 8, viewport.height - 12) };
  }
  const dimensions = {
    "extra-large": { min: 220, gapX: 12, gapY: 12, height: 160 + 8 + line * 2 + (showCardControls ? 16 : 8) + 10 },
    large: { min: 145, gapX: 8, gapY: 8, height: 86 + 8 + line * 2 + (showCardControls ? 16 : 8) + 10 },
    medium: { min: 105, gapX: 4, gapY: 4, height: 48 + 4 + line * 2 + (showCardControls ? 16 : 8) + 10 },
    small: { min: 215, gapX: 12, gapY: 0, height: row },
    tiles: { min: 270, gapX: 10, gapY: 4, height: Math.max(72, Math.max(56, line + smallLine) + (compact ? 8 : 16) + 2) },
    content: { min: width, gapX: 0, gapY: 0, height: Math.max(64, Math.max(56, line + smallLine) + (compact ? 8 : 16) + 2) },
  }[view];
  const inner = Math.max(1, width - 16);
  const columns = Math.max(1, Math.floor((inner + dimensions.gapX) / (dimensions.min + dimensions.gapX)));
  const rows = Math.ceil(count / columns);
  return { axis: "vertical", columns, rows, count, cellWidth: Math.max(1, (inner - (columns - 1) * dimensions.gapX) / columns),
    rowHeight: dimensions.height, gapX: dimensions.gapX, gapY: dimensions.gapY, padding: 8, header: 0, width,
    height: Math.max(0, rows * (dimensions.height + dimensions.gapY) - dimensions.gapY) + 16 };
}

export function explorerListCell(layout: ExplorerListLayout, index: number) {
  const column = layout.axis === "horizontal" ? Math.floor(index / layout.rows) : index % layout.columns;
  const row = layout.axis === "horizontal" ? index % layout.rows : Math.floor(index / layout.columns);
  return { left: layout.padding + column * (layout.cellWidth + layout.gapX),
    top: layout.header + layout.padding + row * (layout.rowHeight + layout.gapY),
    width: layout.cellWidth, height: layout.rowHeight };
}

export function explorerListWindow(layout: ExplorerListLayout, viewport: ExplorerListViewport) {
  if (!layout.count) return { start: 0, end: 0 };
  let start: number, end: number;
  if (layout.axis === "horizontal") {
    const pitch = layout.cellWidth + layout.gapX;
    start = Math.max(0, Math.floor(viewport.left / pitch) - 1) * layout.rows;
    end = (Math.ceil((viewport.left + viewport.width) / pitch) + 1) * layout.rows;
  } else {
    const pitch = layout.rowHeight + layout.gapY;
    start = Math.max(0, Math.floor((viewport.top - layout.header - layout.padding) / pitch) - OVERSCAN) * layout.columns;
    end = (Math.ceil((viewport.top + viewport.height - layout.header) / pitch) + OVERSCAN) * layout.columns;
  }
  const batch = layout.axis === "horizontal" ? layout.rows : layout.columns;
  start = Math.min(start, Math.max(0, layout.count - batch));
  end = Math.min(layout.count, Math.max(start + batch, end));
  return { start, end };
}

/** Add a few interaction owners without mounting the entire gap to the viewport. */
export function explorerListRange(layout: ExplorerListLayout, viewport: ExplorerListViewport, pinned: readonly number[] = []) {
  const { start, end } = explorerListWindow(layout, viewport);
  const indices = new Set<number>();
  for (let index = start; index < end; index++) indices.add(index);
  for (const index of pinned) if (index >= 0 && index < layout.count) indices.add(index);
  return [...indices].sort((a, b) => a - b);
}

export function explorerListScrollTarget(layout: ExplorerListLayout, viewport: ExplorerListViewport, index: number) {
  const cell = explorerListCell(layout, index);
  let top = viewport.top, left = viewport.left;
  if (layout.axis === "horizontal") {
    if (cell.left < left) left = cell.left;
    else if (cell.left + cell.width + 8 > left + viewport.width) left = cell.left + cell.width + 8 - viewport.width;
  } else {
    if (cell.top < top + layout.header) top = cell.top - layout.header;
    else if (cell.top + cell.height > top + viewport.height) top = cell.top + cell.height - viewport.height;
  }
  return { top: Math.max(0, top), left: Math.max(0, left) };
}
