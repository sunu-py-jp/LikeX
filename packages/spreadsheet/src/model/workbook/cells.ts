import { cellAddress, parseCellAddress } from "../address";
import { expandCellAddresses } from "../cell-addresses";
import { getMergedRange, mergedCellPosition } from "../merges";
import type { SpreadsheetCellFormat, SpreadsheetFormatRangeBounds, SpreadsheetFormatRange, SpreadsheetSheet, SpreadsheetWorkbook } from "../types";
import { clearSheetFormatRanges, compactFormatRanges, formatRangesEqual, getCellFormat, preserveFormatRangeEnd, resolveFormatRange, subtractFormatRectangle } from "../format-ranges";
import { formatsEqual } from "../formatting/normalize";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { canonicalCellAddress, fail, normalizeCellFormat, validateCellValue } from "./validation";
import { filterCellValueWrites, type SpreadsheetWriteOptions } from "./write-conflicts";

export function setCellValue(workbook: SpreadsheetWorkbook, sheetId: string, address: string, value: string, options?: SpreadsheetWriteOptions): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), position = mergedCellPosition(sheet, parseCellAddress(canonicalCellAddress(sheet, address))!);
  return setCellValues(workbook, sheetId, { [cellAddress(position.row, position.column)]: value }, options);
}
export function setCellValues(workbook: SpreadsheetWorkbook, sheetId: string, values: Readonly<Record<string, string>>, options?: SpreadsheetWriteOptions): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), next = setSheetCellValues(sheet, values, options);
  return next === sheet ? workbook : replaceWorkbookSheet(workbook, next);
}

/** Shared write preparation; composed structural operations validate the final workbook once. */
export function setSheetCellValues(sheet: SpreadsheetSheet, values: Readonly<Record<string, string>>, options?: SpreadsheetWriteOptions): SpreadsheetSheet {
  const cells = { ...sheet.cells };
  values = filterCellValueWrites(sheet, values, options?.onConflict).values;
  let changed = false;
  for (const [address, raw] of Object.entries(values)) {
    const key = canonicalCellAddress(sheet, address), value = validateCellValue(raw), previous = cells[key];
    const merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (value && merge && key !== cellAddress(merge.top, merge.left)) return fail("結合セルの値は左上のセルにだけ入力してください");
    if ((previous?.value ?? "") === value) continue;
    changed = true;
    if (!value && !previous?.format && !previous?.validation) delete cells[key];
    else cells[key] = freezeCell(value, previous?.format, previous?.validation);
  }
  return changed ? Object.freeze({ ...sheet, cells: Object.freeze(cells) }) : sheet;
}

/** Apply a format to same-sheet cells/ranges; range-containing lists expand to at most 10,000 unique cells. */
export function formatCells(workbook: SpreadsheetWorkbook, sheetId: string, addresses: readonly string[], format: Partial<SpreadsheetCellFormat>): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), cells = { ...sheet.cells };
  // Validate before examining cells so a bad request is rejected atomically.
  normalizeCellFormat(format);
  const expanded = expandCellAddresses(sheet, addresses);
  if (expanded.length >= 32) {
    const points = expanded.map(address => parseCellAddress(address)!).sort((a, b) => a.row - b.row || a.column - b.column);
    const runs: SpreadsheetFormatRange[] = [];
    for (const point of points) {
      const last = runs[runs.length - 1];
      if (last && last.range.top === point.row && last.range.right === point.column - 1) runs[runs.length - 1] = { ...last, range: { ...last.range, right: point.column } };
      else runs.push({ range: { top: point.row, bottom: point.row, left: point.column, right: point.column }, format: { bold: true } });
    }
    let result = workbook;
    for (const item of compactFormatRanges(runs, sheet) ?? []) result = formatCellRange(result, sheetId, item.range, format);
    return result;
  }
  let target = sheet;
  let changed = false;
  for (const key of expanded) {
    const position = parseCellAddress(key)!, previous = cells[key], effective = getCellFormat(sheet, position.row, position.column);
    const next = normalizeCellFormat({ ...effective, ...format });
    if (JSON.stringify(effective) === JSON.stringify(next)) continue;
    changed = true;
    if (!next) target = clearSheetFormatRanges(target, { top: position.row, bottom: position.row, left: position.column, right: position.column });
    if (!previous?.value && !next && !previous?.validation) delete cells[key];
    else cells[key] = freezeCell(previous?.value ?? "", next, previous?.validation);
  }
  return changed ? replaceWorkbookSheet(workbook, { ...target, cells: Object.freeze(cells) }) : workbook;
}

/** Patch every effective format in a rectangle without materializing its blank cells. */
export function formatCellRange(workbook: SpreadsheetWorkbook, sheetId: string, input: SpreadsheetFormatRangeBounds,
  patch: Partial<SpreadsheetCellFormat>): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), range = resolveFormatRange(sheet, input);
  normalizeCellFormat(patch);
  if (!Object.keys(patch).length) return workbook;
  const items: SpreadsheetFormatRange[] = [], intersections: { top: number; left: number; bottom: number; right: number }[] = [];
  for (const item of sheet.formatRanges ?? []) {
    const old = resolveFormatRange(sheet, item.range);
    const part = { top: Math.max(old.top, range.top), bottom: Math.min(old.bottom, range.bottom), left: Math.max(old.left, range.left), right: Math.min(old.right, range.right) };
    if (part.top > part.bottom || part.left > part.right) { items.push(item); continue; }
    items.push(...subtractFormatRectangle(old, range).map(area => ({ range: preserveFormatRangeEnd(area, item.range, sheet), format: item.format })));
    intersections.push(part);
    const bounds = { ...part, ...(input.bottom === "end" && item.range.bottom === "end" ? { bottom: "end" as const } : {}),
      ...(input.right === "end" && item.range.right === "end" ? { right: "end" as const } : {}) };
    const format = normalizeCellFormat({ ...item.format, ...patch });
    if (format) items.push({ range: bounds, format });
  }
  // Sweep the target's uncovered rectangles, bounded by sheet rows/columns rather than area allocation.
  const defaultFormat = normalizeCellFormat(patch);
  if (defaultFormat) {
    const events = new Map<number, { add: typeof intersections; remove: typeof intersections }>();
    const event = (row: number) => { let value = events.get(row); if (!value) { value = { add: [], remove: [] }; events.set(row, value); } return value; };
    event(range.top); event(range.bottom + 1);
    for (const area of intersections) { event(area.top).add.push(area); event(area.bottom + 1).remove.push(area); }
    const rows = [...events.keys()].sort((a, b) => a - b), active = new Set<(typeof intersections)[number]>();
    for (let index = 0; index < rows.length - 1; index++) {
      const top = rows[index], bottom = rows[index + 1] - 1, changes = events.get(top)!;
      changes.remove.forEach(area => active.delete(area)); changes.add.forEach(area => active.add(area));
      let left = range.left;
      for (const area of [...active].sort((a, b) => a.left - b.left)) {
        if (left < area.left) items.push({ range: preserveFormatRangeEnd({ top, bottom, left, right: area.left - 1 }, input, sheet), format: defaultFormat });
        left = area.right + 1;
      }
      if (left <= range.right) items.push({ range: preserveFormatRangeEnd({ top, bottom, left, right: range.right }, input, sheet), format: defaultFormat });
    }
  }
  let next: SpreadsheetSheet = { ...sheet, formatRanges: compactFormatRanges(items, sheet) };
  const cells = { ...sheet.cells };
  let cellChanged = false;
  for (const [address, cell] of Object.entries(cells)) {
    const position = parseCellAddress(address)!;
    if (position.row < range.top || position.row > range.bottom || position.column < range.left || position.column > range.right || !cell.format) continue;
    const format = normalizeCellFormat({ ...cell.format, ...patch });
    // Read just the base: the old explicit cell still lives in next.cells.
    const base = getCellFormat({ ...next, cells: {} }, position.row, position.column);
    if (formatsEqual(format, base)) {
      cellChanged = true;
      if (!cell.value && !cell.validation) delete cells[address]; else cells[address] = freezeCell(cell.value, undefined, cell.validation);
    } else if (format) { cells[address] = freezeCell(cell.value, format, cell.validation); cellChanged = true; }
    else {
      next = clearSheetFormatRanges(next, { top: position.row, bottom: position.row, left: position.column, right: position.column });
      if (!cell.value && !cell.validation) delete cells[address]; else cells[address] = freezeCell(cell.value, undefined, cell.validation);
      cellChanged = true;
    }
  }
  return !cellChanged && formatRangesEqual(sheet.formatRanges, next.formatRanges) ? workbook : replaceWorkbookSheet(workbook, { ...next, cells: Object.freeze(cells) });
}
