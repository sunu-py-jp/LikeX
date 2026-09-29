import type { SpreadsheetCommand, SpreadsheetCommandErrorCode } from "./types";
import { parseCellAddress } from "../model/address";
import { expandCellAddresses } from "../model/cell-addresses";
import type { SpreadsheetSheet, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";

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
  "cells.set": ["values", "onConflict"], "cells.format": ["addresses", "format"], "cells.borders": ["ranges", "preset", "border"],
  "cells.replace": ["query", "replacement", "addresses", "onConflict"],
  "cells.fill": ["source", "target", "mode", "onConflict"],
  "cells.paste": ["target", "payload", "mode", "onConflict", "partialMerges"],
  "cells.move": ["source", "target", "onConflict"],
  "cells.clear": ["range", "mode"], "cells.insert": ["range", "shift"], "cells.delete": ["range", "shift"],
  "namedRanges.add": ["name", "range"],
  "namedRanges.update": ["namedRangeId", "name", "range"],
  "namedRanges.delete": ["namedRangeId", "clear"],
  "namedRanges.clear": ["namedRangeId", "mode"],
  "tables.insert": ["target", "headers", "data", "headerStyle", "rowNumbers", "onConflict", "name"],
  "cells.writeGrid": ["target", "headers", "data", "headerStyle", "rowNumbers", "onConflict", "border"],
  "tables.delete": ["tableId", "clear"],
  "cells.validation": ["addresses", "validation"],
  "conditionalFormats.set": ["rules"],
  "rows.resize": ["row", "height"],
  "dimensions.resize": ["rowHeights", "columnWidths"],
  "dimensions.autoFit": ["axis", "indices"],
  "rows.insert": ["index", "count", "values"], "rows.delete": ["index", "count"],
  "columns.insert": ["index", "count", "values"], "columns.delete": ["index", "count"], "columns.resize": ["column", "width"],
  "cells.merge": ["range", "discardContent"], "cells.unmerge": ["range"],
  "images.insert": ["resource", "anchor", "width", "height", "alt", "flipX", "flipY", "rotation"],
  "shapes.insert": ["shape", "anchor", "width", "height", "fill", "stroke", "strokeWidth", "text", "fontSize", "color", "bold", "flipX", "flipY", "rotation"],
  "textBoxes.insert": ["anchor", "text", "width", "height", "fontSize", "color", "background", "bold", "flipX", "flipY", "rotation"],
  "drawings.paste": ["payload", "anchor"],
  "lines.insert": ["start", "end", "shape", "stroke", "strokeWidth", "startArrow", "endArrow"],
  "lines.update": ["drawingId", "start", "end", "startArrow", "endArrow"],
  "drawings.delete": ["drawingId"], "images.update": ["drawingId", "patch"],
  "shapes.update": ["drawingId", "patch"], "textBoxes.update": ["drawingId", "patch"],
  "comments.set": ["address", "comment"], "sheets.add": ["name"], "sheets.rename": ["name"], "sheets.delete": [], "sheets.move": ["index"],
  "sheets.duplicate": ["name"],
};

export function validateCommand(value: unknown): SpreadsheetCommand {
  const input = commandRecord(value, "コマンド");
  if (typeof input.type !== "string" || !Object.hasOwn(commandFields, input.type)) return rejectCommand("INVALID_COMMAND", "未対応のコマンドです");
  const type = input.type as SpreadsheetCommand["type"];
  commandKeys(input, ["type", ...(type === "sheets.add" ? [] : ["sheetId"]), ...commandFields[type]], "コマンド");
  if (type !== "sheets.add" && (typeof input.sheetId !== "string" || !input.sheetId)) return rejectCommand("INVALID_COMMAND", "sheetIdを指定してください");
  if (type === "sheets.move" && typeof input.index !== "number") return rejectCommand("INVALID_COMMAND", "indexは数値で指定してください");
  for (const key of ["index", "count", "row", "column", "width", "height", "fontSize", "strokeWidth"])
    if (input[key] !== undefined && typeof input[key] !== "number") return rejectCommand("INVALID_COMMAND", `${key}は数値で指定してください`);
  for (const key of ["name", "text", "alt", "fill", "stroke", "color", "background"])
    if (input[key] !== undefined && typeof input[key] !== "string") return rejectCommand("INVALID_COMMAND", `${key}は文字列で指定してください`);
  for (const key of ["bold", "discardContent", "flipX", "flipY"])
    if (input[key] !== undefined && typeof input[key] !== "boolean") return rejectCommand("INVALID_COMMAND", `${key}はtrueまたはfalseで指定してください`);
  if (input.rotation !== undefined && (typeof input.rotation !== "number" || !Number.isFinite(input.rotation)))
    return rejectCommand("INVALID_COMMAND", "rotationは有限の数値で指定してください");
  if (input.onConflict !== undefined && !["error", "overwrite", "skip"].includes(input.onConflict as string))
    return rejectCommand("INVALID_COMMAND", "onConflictはerror、overwrite、skipのいずれかで指定してください");
  if (type === "cells.insert" && input.shift !== "down" && input.shift !== "right")
    return rejectCommand("INVALID_COMMAND", "挿入時のshiftはdownまたはrightで指定してください");
  if (type === "cells.delete" && input.shift !== undefined && input.shift !== "up" && input.shift !== "left")
    return rejectCommand("INVALID_COMMAND", "削除時のshiftはupまたはleftで指定してください");
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

/** Use the public range expander so command staging and direct model calls share target semantics. */
export function requireCommandAddresses(sheet: SpreadsheetSheet, addresses: unknown): readonly string[] {
  if (!Array.isArray(addresses)) return rejectCommand("INVALID_COMMAND", "addressesはセル番地・範囲の配列で指定してください");
  const invalidIndex = addresses.findIndex(address => typeof address !== "string");
  if (invalidIndex !== -1) return rejectCommand("INVALID_COMMAND", `addresses[${invalidIndex}]: セル番地・範囲は文字列で指定してください`);
  try { return expandCellAddresses(sheet, addresses); }
  catch (error) { return rejectCommand("INVALID_TARGET", error instanceof Error ? error.message : "addressesのセル番地・範囲が正しくありません"); }
}
