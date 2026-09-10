import type { SpreadsheetFeatures } from "../../api/features";
import { resolveSpreadsheetFeatures } from "../../api/resolve-features";
import { validateSpreadsheetFeatures } from "../../api/validate-features";
import type { SpreadsheetPastePayload } from "../../api/editing-commands";
import type { SpreadsheetWorkbookSnapshot } from "../../commands/types";
import { cellAddress } from "../address";
import { calculateWorkbook } from "../formula";
import { rangeContains, rangesIntersect } from "../merges";
import { normalizeWorkbook } from "../workbook/normalize";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetWorkbook } from "../types";

export type SpreadsheetCopyOptions = Readonly<{
  features?: SpreadsheetFeatures;
  /** Captures a cut snapshot using the cut permission; it does not remove or arm any cells. */
  kind?: "copy" | "cut";
}>;

/** Read a transferable, JSON-serializable rectangle without a component or browser clipboard. */
export function copySpreadsheetCells(input: SpreadsheetWorkbookSnapshot, sheetId: string, range: SpreadsheetMergedRange,
  options: SpreadsheetCopyOptions = {}): SpreadsheetPastePayload {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.prototype.toString.call(options) !== "[object Object]" ||
    Object.keys(options).some(key => key !== "features" && key !== "kind") ||
    (options.kind !== undefined && options.kind !== "copy" && options.kind !== "cut")) throw new Error("コピーの設定が正しくありません");
  validateSpreadsheetFeatures(options.features);
  const features = resolveSpreadsheetFeatures(options.features);
  if (!(options.kind === "cut" ? features.cut : features.copy)) throw new Error("コピーまたは切り取りは無効です");
  if (!input) throw new Error("コピーするブックを指定してください");
  const workbook = normalizeWorkbook(input as SpreadsheetWorkbook), sheet = workbook.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error("指定されたシートが見つかりません");
  if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).some(key => !["top", "left", "bottom", "right"].includes(key)) ||
    ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) || range.top < 0 || range.left < 0 ||
    range.bottom < range.top || range.right < range.left || range.bottom >= sheet.rowCount || range.right >= sheet.columnCount)
    throw new Error("コピー元の範囲が正しくありません");
  const height = range.bottom - range.top + 1, width = range.right - range.left + 1;
  if (height * width > SPREADSHEET_LIMITS.clipboardCells) throw new Error("コピーできる範囲は 10,000 セルまでです");
  const merges = (sheet.merges ?? []).filter(merge => rangesIntersect(range, merge));
  if (merges.some(merge => !rangeContains(range, merge))) throw new Error("結合されたセルの一部はコピー・切り取りできません。結合全体を選択してください");
  if (options.kind === "cut" && merges.length && !features.mergeCells) throw new Error("セルの結合の変更は無効です");
  const calculated = calculateWorkbook(workbook)[sheetId];
  const values: string[][] = [], displayedValues: string[][] = [], valueTypes: ("string" | "number" | "boolean")[][] = [];
  const formats: NonNullable<SpreadsheetPastePayload["formats"]>[number][] = [];
  const validations: NonNullable<SpreadsheetPastePayload["validations"]>[number][] = [];
  const comments: NonNullable<SpreadsheetPastePayload["comments"]>[number][] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const addresses = Array.from({ length: width }, (_, column) => cellAddress(row, range.left + column));
    values.push(addresses.map(address => sheet.cells[address]?.value ?? ""));
    displayedValues.push(addresses.map(address => String(calculated?.[address] ?? "")));
    valueTypes.push(addresses.map(address => typeof (calculated?.[address] ?? "") as "string" | "number" | "boolean"));
    formats.push(addresses.map(address => sheet.cells[address]?.format ?? null));
    validations.push(addresses.map(address => sheet.cells[address]?.validation ?? null));
    if (features.comments) comments.push(addresses.map(address => {
      const comment = sheet.comments?.[address];
      return comment ? Object.freeze({ text: comment.text, ...(comment.author !== undefined ? { author: comment.author } : {}) }) : null;
    }));
  }
  if (values.reduce((total, row) => total + row.reduce((sum, value) => sum + value.length, 0), 0) > SPREADSHEET_LIMITS.clipboardCharacters)
    throw new Error("コピーする文字数が上限を超えています");
  const matrix = <Value>(rows: readonly (readonly Value[])[]) => Object.freeze(rows.map(row => Object.freeze([...row])));
  return Object.freeze({ values: matrix(values), displayedValues: matrix(displayedValues), valueTypes: matrix(valueTypes),
    formats: matrix(formats), validations: matrix(validations), ...(features.comments ? { comments: matrix(comments) } : {}),
    merges: Object.freeze(merges.map(merge => Object.freeze({ top: merge.top - range.top, left: merge.left - range.left,
      bottom: merge.bottom - range.top, right: merge.right - range.left }))),
    source: Object.freeze({ sheetId, row: range.top, column: range.left }) });
}
