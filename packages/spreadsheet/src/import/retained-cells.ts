import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";

/** Reserve workbook capacity for actual data before optional formatting and validation-only cells. */
export function retainCellData(sheets: SpreadsheetSheet[], context: ImportContext): void {
  const dataCount = sheets.reduce((total, sheet) => total + Object.values(sheet.cells).filter(cell => cell.value !== "").length, 0);
  if (dataCount > SPREADSHEET_LIMITS.cells)
    throw new Error(`Excelファイルを読み込めません: 値・数式を持つセル数が100,000件を超えています（${dataCount}件）`);
  let available = SPREADSHEET_LIMITS.cells - dataCount;
  for (const [index, sheet] of sheets.entries()) {
    context.signal?.throwIfAborted();
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    let omitted = 0;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.value !== "") cells[address] = cell;
      else if (cell.format) {
        if (available > 0) { cells[address] = cell; available--; }
        else omitted++;
      }
    }
    sheets[index] = { ...sheet, cells };
    if (omitted) context.warn({ code: "omitted", sheetName: sheet.name, count: omitted,
      message: "保存できるセル数の上限を超えた空セルの書式を省略しました（値・数式は保持）" });
  }
  context.remainingExtraCells = available;
}
