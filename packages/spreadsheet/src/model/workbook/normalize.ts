import { normalizeConditionalFormats } from "../conditional-formatting";
import { normalizeComments, normalizeDrawings } from "../annotations";
import { normalizeResources } from "../image-resources";
import { normalizeDataValidation } from "../data-validation";
import { normalizeMerges, validateMergedContents } from "../merges";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetWorkbook } from "../types";
import { finishWorkbook, freezeCell } from "./snapshot";
import { canonicalCellAddress, fail, normalizeCellFormat, normalizeSheetName, normalizeSizes, validateCellValue, validateDimension } from "./validation";

/** Validate and copy the complete host boundary. No empty cell matrix is allocated. */
export function normalizeWorkbook(input?: SpreadsheetWorkbook): SpreadsheetWorkbook {
  if (input === undefined) return createWorkbook();
  if (!input || !Array.isArray(input.sheets) || input.sheets.length < 1 || input.sheets.length > SPREADSHEET_LIMITS.sheets)
    return fail("ブックには1〜100枚のシートが必要です");
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) return fail("未対応のブック形式です");
  const resources = normalizeResources(input.resources);
  const ids = new Set<string>(), names = new Set<string>();
  let cellCount = 0;
  const sheets = input.sheets.map(sheet => {
    if (!sheet || typeof sheet.id !== "string" || !sheet.id || sheet.id.length > 200 || /\0/.test(sheet.id) || ids.has(sheet.id))
      return fail("シートの ID が空、重複、または不正です");
    ids.add(sheet.id);
    const name = normalizeSheetName(sheet.name), key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) return fail("同じ名前のシートがあります");
    names.add(key);
    const rowCount = validateDimension(sheet.rowCount, SPREADSHEET_LIMITS.rows), columnCount = validateDimension(sheet.columnCount, SPREADSHEET_LIMITS.columns);
    if (!sheet.cells || typeof sheet.cells !== "object" || Array.isArray(sheet.cells)) return fail("セルの一覧が正しくありません");
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (++cellCount > SPREADSHEET_LIMITS.cells) return fail("保存できるセル数の上限を超えています");
      const canonical = canonicalCellAddress(sheet, address);
      if (Object.hasOwn(cells, canonical)) return fail("同じ位置のセルが重複しています");
      if (!cell || typeof cell !== "object") return fail("セルの値が正しくありません");
      const item = cell as SpreadsheetCell;
      const value = validateCellValue(item.value), format = normalizeCellFormat(item.format), validation = normalizeDataValidation(item.validation);
      if (value || format || validation) cells[canonical] = freezeCell(value, format, validation);
    }
    const columnWidths = normalizeSizes(sheet.columnWidths, columnCount), rowHeights = normalizeSizes(sheet.rowHeights, rowCount, true);
    const drawings = normalizeDrawings(sheet.drawings, { rowCount, columnCount }, resources);
    const comments = normalizeComments(sheet.comments, { rowCount, columnCount });
    const merges = normalizeMerges(sheet.merges, { rowCount, columnCount });
    const conditionalFormats = normalizeConditionalFormats(sheet.conditionalFormats, { rowCount, columnCount });
    validateMergedContents({ cells, comments, merges });
    return Object.freeze({ id: sheet.id, name, cells: Object.freeze(cells), rowCount, columnCount,
      ...(columnWidths ? { columnWidths } : {}), ...(rowHeights ? { rowHeights } : {}),
      ...(drawings ? { drawings } : {}), ...(comments ? { comments } : {}), ...(merges ? { merges } : {}), ...(conditionalFormats ? { conditionalFormats } : {}) });
  });
  return finishWorkbook(sheets, undefined, resources);
}

export function createWorkbook(): SpreadsheetWorkbook {
  return finishWorkbook([Object.freeze({ id: "sheet-1", name: "Sheet1", cells: Object.freeze({}), rowCount: 100, columnCount: 26 })]);
}
