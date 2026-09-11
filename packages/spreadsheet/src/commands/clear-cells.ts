import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { rangesIntersect } from "../model/merges";
import { parseCellAddress } from "../model/address";
import { clearCellRange, resolveCellRange, type SpreadsheetCellRangeInput, type SpreadsheetClearMode } from "../model/workbook/clear";
import type { SpreadsheetWorkbook } from "../model/types";
import { requireCommandFeature, requireCommandSheet } from "./validation";

/** The same feature checks apply to direct, named-range, and table deletion. */
export function clearCommandCells(workbook: SpreadsheetWorkbook, sheetId: string, input: SpreadsheetCellRangeInput,
  mode: SpreadsheetClearMode, features: SpreadsheetFeatureSettings): SpreadsheetWorkbook {
  const sheet = requireCommandSheet(workbook, sheetId), range = resolveCellRange(sheet, input);
  if (mode === "all") {
    const contains = (address: string) => { const p = parseCellAddress(address)!;
      return p.row >= range.top && p.row <= range.bottom && p.column >= range.left && p.column <= range.right; };
    for (const [address, cell] of Object.entries(sheet.cells)) if (contains(address)) {
      if (cell.format) requireCommandFeature(features, "formatting");
      if (cell.validation) requireCommandFeature(features, "dataValidation");
      if (cell.validation?.type === "checkbox") requireCommandFeature(features, "checkboxes");
    }
    if (Object.keys(sheet.comments ?? {}).some(contains)) requireCommandFeature(features, "comments");
    if (sheet.merges?.some(merge => rangesIntersect(merge, range))) requireCommandFeature(features, "mergeCells");
    if (sheet.tables?.some(table => rangesIntersect(table.range, range))) requireCommandFeature(features, "tables");
    if (sheet.conditionalFormats?.some(rule => rule.ranges.some(area => rangesIntersect(area, range))))
      requireCommandFeature(features, "conditionalFormatting");
  }
  return clearCellRange(workbook, sheetId, range, mode);
}
