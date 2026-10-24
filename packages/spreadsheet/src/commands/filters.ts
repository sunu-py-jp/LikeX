import type { SpreadsheetFilterCommand } from "../api/filter-commands";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { normalizeSpreadsheetAutoFilter, resolveSpreadsheetFilterRange } from "../model/filters";
import type { SpreadsheetAutoFilter, SpreadsheetWorkbook } from "../model/types";
import { replaceWorkbookSheet } from "../model/workbook/snapshot";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

export function stageFilterCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetFilterCommand,
  features: SpreadsheetFeatureSettings): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } {
  requireCommandFeature(features, "filters");
  const sheet = requireCommandSheet(workbook, command.sheetId);
  let autoFilter: SpreadsheetAutoFilter | undefined = sheet.autoFilter;
  if (command.type === "filters.setRange") {
    const range = resolveSpreadsheetFilterRange(sheet, command.range, command.inferRows);
    autoFilter = normalizeSpreadsheetAutoFilter({ range }, sheet);
  } else if (command.type === "filters.remove") autoFilter = undefined;
  else if (command.type === "filters.clear") autoFilter = autoFilter ? Object.freeze({ range: autoFilter.range }) : undefined;
  else if (command.type === "filters.setValues") {
    if (!autoFilter) return rejectCommand("INVALID_TARGET", "フィルター範囲を先に設定してください");
    if (!Number.isInteger(command.column) || command.column < autoFilter.range.left || command.column > autoFilter.range.right)
      return rejectCommand("INVALID_TARGET", "フィルター列が範囲外です");
    const columns = (autoFilter.columns ?? []).filter(item => item.column !== command.column);
    if (command.values !== null) columns.push({ column: command.column, values: command.values });
    autoFilter = normalizeSpreadsheetAutoFilter({ range: autoFilter.range, columns }, sheet);
  }
  const updated = { ...sheet, autoFilter };
  if (!autoFilter) delete updated.autoFilter;
  return { workbook: replaceWorkbookSheet(workbook, updated),
    receipt: { type: command.type, sheetId: sheet.id, ...(autoFilter ? { range: autoFilter.range } : {}) } };
}
