import { normalizeWorkbook } from "./workbook";
import { SPREADSHEET_LIMITS, type SpreadsheetWorkbook } from "./types";

const tooLarge = (): never => { throw new Error("ブックの JSON は64 Mi文字以内にしてください"); };

/** Check output length before allocating a potentially enormous combined JSON string. */
function assertSerializedSize(input: SpreadsheetWorkbook): void {
  let size = 0;
  const count = (value: unknown): void => {
    if (value === undefined) return;
    if (value === null || typeof value !== "object") size += JSON.stringify(value).length;
    else if (Array.isArray(value)) {
      size += 2 + Math.max(0, value.length - 1);
      for (const item of value) count(item);
    } else {
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      size += 2 + Math.max(0, entries.length - 1);
      for (const [key, item] of entries) { size += JSON.stringify(key).length + 1; count(item); }
    }
    if (size > SPREADSHEET_LIMITS.serializedCharacters) tooLarge();
  };
  count(input);
}

/** A complete self-contained snapshot, including embedded image bytes and annotations. */
export function serializeWorkbook(input: SpreadsheetWorkbook): string {
  const workbook = normalizeWorkbook(input);
  assertSerializedSize(workbook);
  return JSON.stringify(workbook);
}

export function parseWorkbook(json: string): SpreadsheetWorkbook {
  if (typeof json !== "string") throw new Error("ブックの JSON は文字列で指定してください");
  if (json.length > SPREADSHEET_LIMITS.serializedCharacters) tooLarge();
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error("ブックの JSON を読み込めませんでした"); }
  return normalizeWorkbook(input as SpreadsheetWorkbook);
}
