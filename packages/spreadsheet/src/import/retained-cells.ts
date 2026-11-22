import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";

/** Reserve one sheet's capacity for actual data before optional formatting-only cells. */
export function retainCellData(sheet: SpreadsheetSheet, context: ImportContext): SpreadsheetSheet {
  context.signal?.throwIfAborted();
  const entries = Object.entries(sheet.cells);
  const dataCount = entries.reduce((total, [, cell]) => total + (cell.value !== "" ? 1 : 0), 0);
  if (dataCount > SPREADSHEET_LIMITS.cells)
    throw new Error(`Excelファイルを読み込めません: シート「${sheet.name}」の値・数式を持つセル数が100,000件を超えています（${dataCount}件）`);
  let available = SPREADSHEET_LIMITS.cells - dataCount, omitted = 0;
  const cells: Record<string, SpreadsheetCell> = Object.create(null);
  for (const [address, cell] of entries) {
    if (cell.value !== "") cells[address] = cell;
    else if (cell.format) {
      if (available > 0) { cells[address] = cell; available--; }
      else omitted++;
    }
  }
  if (omitted) context.warn({ code: "omitted", sheetName: sheet.name, count: omitted,
    message: "1シートに保存できるセル数の上限を超えた空セルの書式を省略しました（値・数式は保持）" });
  return { ...sheet, cells };
}
