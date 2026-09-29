import { cellAddress } from "../address";
import { normalizeCellFormat } from "../formatting";
import type { SpreadsheetCellBorder, SpreadsheetCellBorders } from "../formatting";
import { expandRangeForMerges, getMergedRange, validateMergedRange } from "../merges";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetWorkbook } from "../types";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";

export type SpreadsheetBorderPreset = "all" | "outside" | "inside" | "top" | "bottom" | "left" | "right" | "none";
type Edge = keyof SpreadsheetCellBorders;
type BorderPatch = Partial<Record<Edge, SpreadsheetCellBorder | undefined>>;
const edges: readonly Edge[] = ["top", "right", "bottom", "left"];
const opposite: Record<Edge, Edge> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const presets: readonly SpreadsheetBorderPreset[] = ["all", "outside", "inside", ...edges, "none"];

/** Format geometric edges, sharing the same immutable model operation with GUI, API and CLI. */
export function setCellBorders(workbook: SpreadsheetWorkbook, sheetId: string, ranges: readonly SpreadsheetMergedRange[],
  preset: SpreadsheetBorderPreset, border?: SpreadsheetCellBorder): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (!presets.includes(preset)) throw new Error("罫線の種類が正しくありません");
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > 1000) throw new Error("罫線の範囲は1〜1000件で指定してください");
  if (border !== undefined && (!border || typeof border !== "object" || Array.isArray(border) || Object.keys(border).some(key => !["style", "width", "color"].includes(key)))) throw new Error("罫線が正しくありません");
  const normalized = normalizeCellFormat({ borders: { top: border ?? {} } })!.borders!.top!;
  const line = preset === "none" || normalized.style === "none" ? undefined : Object.freeze({ style: normalized.style ?? "solid", width: normalized.width ?? 1, color: normalized.color ?? "#808080" });
  const selected = new Set<string>();
  const expanded = ranges.map(range => {
    if (range && Object.keys(range).some(key => !["top", "left", "bottom", "right"].includes(key))) throw new Error("罫線の範囲に未対応の項目があります");
    validateMergedRange(range, sheet, true);
    const result = expandRangeForMerges(sheet, range);
    for (let row = result.top; row <= result.bottom; row++) for (let column = result.left; column <= result.right; column++) {
      selected.add(cellAddress(row, column));
      if (selected.size > SPREADSHEET_LIMITS.rangeCells) throw new Error("罫線の選択範囲は結合セルを含めて10,000セル以下にしてください");
    }
    return result;
  });
  const patches = new Map<string, BorderPatch>(), displayPatches = new Map<string, BorderPatch>();
  const patch = (target: Map<string, BorderPatch>, row: number, column: number, edge: Edge) => {
    const address = cellAddress(row, column), value = target.get(address) ?? {};
    value[edge] = line; target.set(address, value);
    if (patches.size + displayPatches.size > SPREADSHEET_LIMITS.cells) throw new Error("隣接する結合セルを含む罫線の更新範囲が上限を超えています");
  };
  const logical = (row: number, column: number) => getMergedRange(sheet, { row, column }) ?? { top: row, bottom: row, left: column, right: column };
  const queue: { range: SpreadsheetMergedRange; edge: Edge }[] = [], visited = new Set<string>();
  const enqueue = (range: SpreadsheetMergedRange, edge: Edge) => {
    const key = `${range.top}:${range.left}:${range.bottom}:${range.right}:${edge}`;
    if (visited.has(key)) return;
    visited.add(key); queue.push({ range, edge });
    if (visited.size > SPREADSHEET_LIMITS.cells * 4) throw new Error("罫線の更新範囲が上限を超えています");
  };
  for (const range of expanded) for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
    const cell = logical(row, column);
    if (preset === "none") for (const edge of edges) patch(patches, row, column, edge);
    for (const edge of edges) {
      const outer = edge === "top" ? cell.top === range.top : edge === "bottom" ? cell.bottom === range.bottom : edge === "left" ? cell.left === range.left : cell.right === range.right;
      if (preset === "all" || preset === "none" || preset === "outside" && outer || preset === "inside" && !outer || preset === edge && outer) enqueue(cell, edge);
    }
  }
  // A merge is one visual cell. Synchronize the whole touched edge with its neighbour,
  // including a neighbouring merge, so an older opposite-side border cannot win.
  for (let index = 0; index < queue.length; index++) {
    const { range, edge } = queue[index];
    const merged = range.top !== range.bottom || range.left !== range.right;
    if (merged) patch(displayPatches, range.top, range.left, edge);
    const horizontal = edge === "top" || edge === "bottom";
    const start = horizontal ? range.left : range.top, end = horizontal ? range.right : range.bottom;
    for (let position = start; position <= end; position++) {
      const row = horizontal ? edge === "top" ? range.top : range.bottom : position;
      const column = horizontal ? position : edge === "left" ? range.left : range.right;
      patch(patches, row, column, edge);
      const adjacentRow = row + (edge === "top" ? -1 : edge === "bottom" ? 1 : 0);
      const adjacentColumn = column + (edge === "left" ? -1 : edge === "right" ? 1 : 0);
      if (adjacentRow >= 0 && adjacentRow < sheet.rowCount && adjacentColumn >= 0 && adjacentColumn < sheet.columnCount) enqueue(logical(adjacentRow, adjacentColumn), opposite[edge]);
    }
  }
  for (const [address, value] of displayPatches) patches.set(address, { ...patches.get(address), ...value });
  const cells = { ...sheet.cells };
  let changed = false;
  for (const [address, value] of patches) {
    const previous = cells[address], borders = { ...previous?.format?.borders };
    let different = false;
    for (const edge of edges) if (Object.hasOwn(value, edge)) {
      const next = value[edge];
      if (next === undefined) { if (Object.hasOwn(borders, edge)) { delete borders[edge]; different = true; } }
      else if (JSON.stringify(borders[edge]) !== JSON.stringify(next)) { borders[edge] = next; different = true; }
    }
    if (!different) continue;
    changed = true;
    const source = { ...previous?.format };
    if (Object.keys(borders).length) source.borders = borders; else delete source.borders;
    const format = normalizeCellFormat(source);
    if (!previous?.value && !format && !previous?.validation) delete cells[address];
    else cells[address] = freezeCell(previous?.value ?? "", format, previous?.validation);
  }
  return changed ? replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}
