import { filterCellValueWrites, type SpreadsheetWriteConflictPolicy } from "../workbook/write-conflicts";
import type { SpreadsheetPasteMode, SpreadsheetPastePayload } from "../../api/editing-commands";
import { cellAddress } from "../address";
import { translateFormula } from "../formula";
import { normalizeDataValidation } from "../data-validation";
import { getMergedRange, normalizeMerges, rangeContains, rangesIntersect } from "../merges";
import { mergeCells, unmergeCells } from "../workbook/merges";
import { setCellComments } from "../workbook/annotations";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetCellPosition,
  type SpreadsheetComment, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { getWorkbookSheet, replaceWorkbookSheet } from "../workbook/snapshot";
import { normalizeCellFormat, validateCellValue } from "../workbook/validation";

export type PastePolicy = Readonly<{ formulas: boolean; formatting: boolean; dataValidation?: boolean; checkboxes?: boolean;
  comments?: boolean; mergeCells?: boolean; onConflict?: SpreadsheetWriteConflictPolicy; skippedAddresses?: Set<string> }>;

function payloadSize(payload: SpreadsheetPastePayload) {
  if (!payload || !Array.isArray(payload.values) || payload.values.length > SPREADSHEET_LIMITS.clipboardCells ||
    Array.from(payload.values).some(row => !Array.isArray(row) || Array.from(row).some(value => typeof value !== "string")))
    throw new Error("貼り付ける値は文字列の二次元配列で指定してください");
  const height = payload.values.length, width = Math.max(0, ...payload.values.map(row => row.length));
  if (height * width > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度に貼り付けできる範囲は10,000セルまでです");
  return { height, width };
}

/** Resolve a scalar paste to a merged cell's anchor and validate the complete destination geometry. */
export function getCellPasteRange(sheet: SpreadsheetSheet, target: SpreadsheetCellPosition,
  payload: SpreadsheetPastePayload): SpreadsheetMergedRange | undefined {
  const { height, width } = payloadSize(payload);
  if (!height || !width) return undefined;
  if (!target || !Number.isInteger(target.row) || !Number.isInteger(target.column) || target.row < 0 || target.column < 0 ||
    target.row >= sheet.rowCount || target.column >= sheet.columnCount) throw new Error("貼り付け先がシートの範囲外です。行・列が足りません");
  if (payload.merges !== undefined) normalizeMerges(payload.merges, { rowCount: height, columnCount: width });
  const scalar = height === 1 && width === 1 && !payload.merges?.length ? getMergedRange(sheet, target) : undefined;
  const top = scalar?.top ?? target.row, left = scalar?.left ?? target.column;
  const destination = { top, left, bottom: top + height - 1, right: left + width - 1 };
  if (destination.bottom >= sheet.rowCount || destination.right >= sheet.columnCount)
    throw new Error("貼り付け先がシートの範囲外です。行・列が足りません");
  const merges = (sheet.merges ?? []).filter(merge => rangesIntersect(destination, merge));
  if (!scalar) {
    if (merges.some(merge => !rangeContains(destination, merge)))
      throw new Error("結合されたセルの一部には貼り付けできません。結合を解除するか、結合全体を選択してください");
    if (payload.merges === undefined && merges.length) throw new Error("結合されたセルを含む範囲への貼り付けには、先に結合を解除してください");
  }
  return destination;
}

/** Values, formats, validation, comments and merges use the same atomic transfer for commands and GUI. */
export function pasteSpreadsheetCells(workbook: SpreadsheetWorkbook, sheetId: string, target: SpreadsheetCellPosition,
  payload: SpreadsheetPastePayload, mode: SpreadsheetPasteMode = "all", policy: PastePolicy = { formulas: true, formatting: true, dataValidation: true },
  nextCommentId: () => string = () => crypto.randomUUID()): SpreadsheetWorkbook {
  const skippedAddresses = policy.skippedAddresses ?? new Set<string>();
  policy = { ...policy, skippedAddresses };
  const sheet = getWorkbookSheet(workbook, sheetId), destination = getCellPasteRange(sheet, target, payload);
  if (!destination) return pasteCellMatrix(workbook, sheetId, target, payload, mode, policy);
  const merged = (sheet.merges ?? []).filter(merge => rangesIntersect(destination, merge));
  const scalar = destination.top === destination.bottom && destination.left === destination.right && !payload.merges?.length;
  if (policy.mergeCells === false && !scalar && (payload.merges?.length || merged.length)) throw new Error("セルの結合の変更は無効です");
  const { height, width } = payloadSize(payload);
  if (payload.comments !== undefined && (!Array.isArray(payload.comments) || payload.comments.length !== height ||
    Array.from(payload.comments).some(row => !Array.isArray(row) || row.length > width))) throw new Error("貼り付けるコメントの行列が一致していません");
  let next = mode === "all" && payload.merges !== undefined && !scalar && merged.length ? unmergeCells(workbook, sheetId, destination) : workbook;
  next = pasteCellMatrix(next, sheetId, { row: destination.top, column: destination.left }, payload, mode, policy);
  if (mode !== "all") return next;
  if (skippedAddresses.size && !scalar && (payload.merges?.length || merged.length))
    throw new Error("結合の変更を伴う貼り付けでは一部のセルをスキップできません");
  if (payload.comments && policy.comments !== false) {
    const comments: Record<string, SpreadsheetComment | null> = {};
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      if (skippedAddresses.has(cellAddress(destination.top + row, destination.left + column))) continue;
      const comment = payload.comments[row]?.[column] ?? null;
      if (comment !== null && (!comment || typeof comment !== "object" || Array.isArray(comment) ||
        Object.keys(comment).some(key => key !== "text" && key !== "author"))) throw new Error("貼り付けるコメントが正しくありません");
      comments[cellAddress(destination.top + row, destination.left + column)] = comment ? { ...comment, id: nextCommentId() } : null;
    }
    next = setCellComments(next, sheetId, comments);
  }
  for (const merge of payload.merges ?? []) next = mergeCells(next, sheetId, {
    top: destination.top + merge.top, left: destination.left + merge.left,
    bottom: destination.top + merge.bottom, right: destination.left + merge.right,
  });
  return next;
}

/** Values, formats and validation rules are published together so no invalid intermediate cell is exposed. */
function pasteCellMatrix(workbook: SpreadsheetWorkbook, sheetId: string, target: SpreadsheetCellPosition,
  payload: SpreadsheetPastePayload, mode: SpreadsheetPasteMode = "all", policy: PastePolicy = { formulas: true, formatting: true, dataValidation: true }): SpreadsheetWorkbook {
  if (!["all", "values", "formulas", "formats"].includes(mode)) throw new Error("貼り付け形式が正しくありません");
  const { height, width } = payloadSize(payload);
  if (payload.values.reduce((total: number, row: readonly string[]) => total + row.reduce((size, value) => size + value.length, 0), 0) > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("貼り付ける文字数が上限を超えています");
  if (!height || !width) return workbook;
  const sheet = getWorkbookSheet(workbook, sheetId);
  for (const matrix of [payload.displayedValues, payload.valueTypes, payload.formats, payload.validations])
    if (matrix !== undefined && (!Array.isArray(matrix) || matrix.length !== height || Array.from(matrix).some(row => !Array.isArray(row) || row.length > width))) throw new Error("貼り付けデータの行列の形が一致していません");
  if (payload.displayedValues?.some(row => Array.from(row).some(value => typeof value !== "string"))) throw new Error("計算結果は文字列で指定してください");
  if (payload.valueTypes?.some(row => Array.from(row).some(value => !["string", "number", "boolean"].includes(value)))) throw new Error("計算結果の型が正しくありません");
  if (payload.source && (!Number.isInteger(payload.source.row) || !Number.isInteger(payload.source.column) || payload.source.row < 0 || payload.source.column < 0 || typeof payload.source.sheetId !== "string")) throw new Error("コピー元の位置が正しくありません");
  if (!target || !Number.isInteger(target.row) || !Number.isInteger(target.column) || target.row < 0 || target.column < 0 ||
    target.row + height > sheet.rowCount || target.column + width > sheet.columnCount) throw new Error("貼り付け先がシートの範囲外です");
  if (mode === "formats" && (!policy.formatting || !payload.formats)) throw new Error("書式の貼り付けには、このスプレッドシートでコピーした書式が必要です");
  const cells = { ...sheet.cells }, proposed: Record<string, string> = {};
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const position = { row: target.row + row, column: target.column + column }, address = cellAddress(position.row, position.column);
    const merge = getMergedRange(sheet, position);
    if (merge && (merge.top !== position.row || merge.left !== position.column)) throw new Error("結合されたセルの一部には貼り付けできません");
    const previous = cells[address];
    let value = previous?.value ?? "";
    if (mode !== "formats") {
      value = (mode === "values" ? payload.displayedValues ?? payload.values : payload.values)[row]?.[column] ?? "";
      if (mode === "values") {
        if (payload.valueTypes?.[row]?.[column] === "string" || value.startsWith("=") || value.startsWith("'")) value = value ? `'${value}` : "";
      } else if (value.startsWith("=")) {
        if (!policy.formulas) throw new Error("数式の入力は無効です");
        if (payload.source) value = translateFormula(value, target.row - payload.source.row, target.column - payload.source.column);
      }
      value = validateCellValue(value);
      proposed[address] = value;
    }
    let format: SpreadsheetCellFormat | undefined = previous?.format;
    if ((mode === "all" || mode === "formats") && policy.formatting && payload.formats) format = normalizeCellFormat(payload.formats[row]?.[column] ?? {});
    const suppliedValidation = payload.validations?.[row]?.[column];
    const ruleTransferEnabled = policy.dataValidation !== false && !(policy.checkboxes === false && (suppliedValidation?.type === "checkbox" || previous?.validation?.type === "checkbox"));
    const validation = mode === "all" && ruleTransferEnabled && payload.validations ? normalizeDataValidation(suppliedValidation ?? undefined) : previous?.validation;
    if (!value && !format && !validation) delete cells[address];
    else cells[address] = Object.freeze({ value, ...(format ? { format } : {}), ...(validation ? { validation } : {}) }) as SpreadsheetCell;
  }
  const filtered = filterCellValueWrites(sheet, proposed, policy.onConflict);
  for (const address of filtered.skippedAddresses) {
    policy.skippedAddresses?.add(address);
    if (sheet.cells[address]) cells[address] = sheet.cells[address]; else delete cells[address];
  }
  return replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) });
}
