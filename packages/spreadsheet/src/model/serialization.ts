import { serializeStableJson } from "../json";
import { normalizeWorkbook } from "./workbook/normalize";
import { SPREADSHEET_LIMITS, type SpreadsheetWorkbook } from "./types";
import { compareWorkbookFileKeys, fileToWorkbook, workbookToFile } from "./native-file";

const tooLarge = (): never => { throw new Error("ブックの JSON は64 Mi文字以内にしてください"); };

/** Stable, row-oriented SPON v1 JSON. Runtime cells remain A1-addressed and arrays retain their order. */
export function serializeWorkbook(input: SpreadsheetWorkbook): string {
  const workbook = normalizeWorkbook(input);
  try { return serializeStableJson(workbookToFile(workbook), { maxLength: SPREADSHEET_LIMITS.serializedCharacters,
    space: 2, compareKeys: compareWorkbookFileKeys }); }
  catch (error) {
    if (error instanceof RangeError) return tooLarge();
    throw error;
  }
}

/** Read an explicitly identified SPON v1 file with row-oriented sheets into the runtime model. */
export function parseWorkbook(json: string): SpreadsheetWorkbook {
  if (typeof json !== "string") throw new Error("ブックの JSON は文字列で指定してください");
  if (json.length > SPREADSHEET_LIMITS.serializedCharacters) tooLarge();
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error("ブックの JSON を読み込めませんでした"); }
  return normalizeWorkbook(fileToWorkbook(input));
}
