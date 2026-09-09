import type { SpreadsheetCommand, SpreadsheetCommandErrorCode } from "../../api/types";
import { parseCellAddress } from "../../model/address";
import type { SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";
import type { SpreadsheetFeatureSettings } from "../features";

export class SpreadsheetCommandError extends Error {
  constructor(readonly code: SpreadsheetCommandErrorCode, message: string) { super(message); }
}
export function rejectCommand(code: SpreadsheetCommandErrorCode, message: string): never {
  throw new SpreadsheetCommandError(code, message);
}
export function commandRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]")
    return rejectCommand("INVALID_COMMAND", `${label}はオブジェクトで指定してください`);
  return value as Record<string, unknown>;
}
export function commandKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) rejectCommand("INVALID_COMMAND", `${label}に未対応のプロパティがあります`);
}

const commandFields: Record<SpreadsheetCommand["type"], readonly string[]> = {
  "cells.set": ["values"], "cells.format": ["addresses", "format"],
  "rows.insert": ["index", "count"], "rows.delete": ["index", "count"],
  "columns.insert": ["index", "count"], "columns.delete": ["index", "count"], "columns.resize": ["column", "width"],
  "cells.merge": ["range", "discardContent"], "cells.unmerge": ["range"],
  "images.insert": ["resource", "anchor", "width", "height", "alt"],
  "shapes.insert": ["shape", "anchor", "width", "height", "fill", "stroke", "strokeWidth"],
  "textBoxes.insert": ["anchor", "text", "width", "height", "fontSize", "color", "background", "bold"],
  "drawings.delete": ["drawingId"], "images.update": ["drawingId", "patch"],
  "shapes.update": ["drawingId", "patch"], "textBoxes.update": ["drawingId", "patch"],
  "comments.set": ["address", "comment"], "sheets.add": ["name"], "sheets.rename": ["name"], "sheets.delete": [],
};

export function validateCommand(value: unknown): SpreadsheetCommand {
  const input = commandRecord(value, "コマンド");
  if (typeof input.type !== "string" || !Object.hasOwn(commandFields, input.type)) return rejectCommand("INVALID_COMMAND", "未対応のコマンドです");
  const type = input.type as SpreadsheetCommand["type"];
  commandKeys(input, ["type", ...(type === "sheets.add" ? [] : ["sheetId"]), ...commandFields[type]], "コマンド");
  if (type !== "sheets.add" && (typeof input.sheetId !== "string" || !input.sheetId)) return rejectCommand("INVALID_COMMAND", "sheetIdを指定してください");
  for (const key of ["index", "count", "column", "width", "height", "fontSize", "strokeWidth"])
    if (input[key] !== undefined && typeof input[key] !== "number") return rejectCommand("INVALID_COMMAND", `${key}は数値で指定してください`);
  for (const key of ["name", "text", "alt", "fill", "stroke", "color", "background"])
    if (input[key] !== undefined && typeof input[key] !== "string") return rejectCommand("INVALID_COMMAND", `${key}は文字列で指定してください`);
  for (const key of ["bold", "discardContent"])
    if (input[key] !== undefined && typeof input[key] !== "boolean") return rejectCommand("INVALID_COMMAND", `${key}はtrueまたはfalseで指定してください`);
  return input as SpreadsheetCommand;
}

export function requireCommandFeature(features: SpreadsheetFeatureSettings, feature: keyof SpreadsheetFeatureSettings): void {
  if (!features[feature]) rejectCommand("FEATURE_DISABLED", `機能「${feature}」は無効です`);
}
export function requireCommandSheet(workbook: SpreadsheetWorkbook, sheetId: string): SpreadsheetSheet {
  return workbook.sheets.find(sheet => sheet.id === sheetId) ?? rejectCommand("INVALID_TARGET", "指定されたシートが見つかりません");
}
export function requireCommandAddress(sheet: SpreadsheetSheet, address: unknown): void {
  if (typeof address !== "string") return rejectCommand("INVALID_COMMAND", "セルのアドレスは文字列で指定してください");
  const position = parseCellAddress(address);
  if (!position || position.row >= sheet.rowCount || position.column >= sheet.columnCount)
    rejectCommand("INVALID_TARGET", "セルの位置がシートの範囲外です");
}
