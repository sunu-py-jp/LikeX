import { collectConditionalConflicts, type ConditionalEditConflict } from "../json";
import { cellAddress, parseCellAddress } from "../model/address";
import { expandCellAddresses } from "../model/cell-addresses";
import { mergedCellPosition } from "../model/merges";
import { normalizeWorkbook } from "../model/workbook/normalize";
import type { SpreadsheetWorkbook, SpreadsheetCellFormat } from "../model/types";
import type { SpreadsheetCommand, SpreadsheetCommandFailure, SpreadsheetCommandOptions,
  SpreadsheetExpectedWorkbook, SpreadsheetMutationToken } from "./types";
import { commandKeys, commandRecord, SpreadsheetCommandError, validateCommand } from "./validation";

export function captureSpreadsheetCondition(options?: SpreadsheetCommandOptions):
  { ok: true; expected?: SpreadsheetExpectedWorkbook } | SpreadsheetCommandFailure {
  try {
    if (options === undefined) return { ok: true };
    commandKeys(commandRecord(options, "条件付き更新の設定"), ["expected"], "条件付き更新の設定");
    if (options.expected === undefined) return { ok: true };
    const input = commandRecord(options.expected, "変更前の状態");
    commandKeys(input, ["workbook", "token", "scope"], "変更前の状態");
    if (input.scope !== undefined && input.scope !== "targets" && input.scope !== "workbook") throw new Error("照合範囲はtargetsまたはworkbookを指定してください");
    if (input.workbook === undefined) throw new Error("照合する変更前のブックを指定してください");
    const workbook = normalizeWorkbook(input.workbook as SpreadsheetWorkbook);
    let token: SpreadsheetMutationToken | undefined;
    if (input.token !== undefined) {
      const supplied = commandRecord(input.token, "編集トークン");
      commandKeys(supplied, ["sessionId", "structureRevision"], "編集トークン");
      if (typeof supplied.sessionId !== "string" || !supplied.sessionId || supplied.sessionId.length > 200 ||
        !Number.isSafeInteger(supplied.structureRevision) || (supplied.structureRevision as number) < 0)
        throw new Error("編集トークンが正しくありません");
      token = Object.freeze({ sessionId: supplied.sessionId, structureRevision: supplied.structureRevision as number });
    }
    return { ok: true, expected: Object.freeze({ workbook, ...(token ? { token } : {}), ...(input.scope ? { scope: input.scope } : {}) }) };
  } catch (cause) {
    return Object.freeze({ ok: false, code: cause instanceof SpreadsheetCommandError ? cause.code : "INVALID_COMMAND",
      message: cause instanceof Error ? cause.message : "変更前の状態が正しくありません" });
  }
}

function workbookStructure(workbook: SpreadsheetWorkbook) {
  return { namedRanges: workbook.namedRanges ?? [], sheets: workbook.sheets.map(sheet => ({
    id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
    merges: sheet.merges ?? [], drawings: sheet.drawings?.map(drawing => ({ id: drawing.id, type: drawing.type })) ?? [],
    tables: sheet.tables ?? [],
  })) };
}

/** Minimal guards only for operations whose complete reads/writes are known. Everything else is guarded as a whole workbook. */
function dependencies(workbook: SpreadsheetWorkbook, commands: readonly SpreadsheetCommand[]): Map<string, unknown> {
  const guards = new Map<string, unknown>([["structure", workbookStructure(workbook)]]);
  const whole = () => new Map<string, unknown>([["workbook", workbook]]);
  for (const source of commands) {
    const command = validateCommand(source);
    if (!("sheetId" in command)) return whole();
    const sheet = workbook.sheets.find(item => item.id === command.sheetId);
    const base = `sheets[${JSON.stringify(command.sheetId)}]`;
    guards.set(`${base}.id`, sheet?.id);
    guards.set(`${base}.rowCount`, sheet?.rowCount);
    guards.set(`${base}.columnCount`, sheet?.columnCount);
    guards.set(`${base}.merges`, sheet?.merges ?? []);
    const cell = (address: string) => {
      const position = parseCellAddress(address);
      return position ? cellAddress(position.row, position.column) : address;
    };
    const addresses = (values: readonly string[]) => sheet ? expandCellAddresses(sheet, values) : values;
    const field = (address: string, key: string, value: unknown) => guards.set(`${base}.cells.${cell(address)}.${key}`, value);
    switch (command.type) {
      case "cells.set":
        for (const address of Object.keys(command.values)) {
          const value = sheet?.cells[cell(address)];
          field(address, "value", value?.value ?? "");
          // A text number format changes whether a leading '=' is a formula.
          field(address, "format.numberFormat", value?.format?.numberFormat ?? "general");
          field(address, "validation", value?.validation);
        }
        break;
      case "cells.format":
        for (const address of addresses(command.addresses)) {
          const value = sheet?.cells[cell(address)];
          for (const key of Object.keys(command.format)) field(address, `format.${key}`, value?.format?.[key as keyof SpreadsheetCellFormat]);
          if (Object.hasOwn(command.format, "numberFormat")) field(address, "value", value?.value ?? "");
        }
        break;
      case "cells.validation":
        for (const address of addresses(command.addresses)) field(address, "validation", sheet?.cells[cell(address)]?.validation);
        break;
      case "comments.set": {
        const parsed = parseCellAddress(command.address);
        const position = sheet && parsed ? mergedCellPosition(sheet, parsed) : parsed;
        const address = position ? cellAddress(position.row, position.column) : command.address;
        guards.set(`${base}.comments.${address}`, sheet?.comments?.[address]);
        break;
      }
      case "rows.resize": guards.set(`${base}.rowHeights.${command.row}`, sheet?.rowHeights?.[command.row] ?? 28); break;
      case "columns.resize": guards.set(`${base}.columnWidths.${command.column}`, sheet?.columnWidths?.[command.column] ?? 100); break;
      case "dimensions.resize":
        for (const key of Object.keys(command.rowHeights ?? {})) guards.set(`${base}.rowHeights.${key}`, sheet?.rowHeights?.[Number(key)] ?? 28);
        for (const key of Object.keys(command.columnWidths ?? {})) guards.set(`${base}.columnWidths.${key}`, sheet?.columnWidths?.[Number(key)] ?? 100);
        break;
      case "conditionalFormats.set": guards.set(`${base}.conditionalFormats`, sheet?.conditionalFormats ?? []); break;
      case "images.update": case "shapes.update": case "textBoxes.update": {
        const keys = Object.keys(command.patch);
        // Geometry can propagate into connected lines; resource changes may prune shared resources.
        if (keys.some(key => !["text", "color", "fontSize", "bold", "alt", "fill", "stroke", "strokeWidth", "background"].includes(key))) return whole();
        const drawing = sheet?.drawings?.find(item => item.id === command.drawingId);
        const path = `${base}.drawings[${JSON.stringify(command.drawingId)}]`;
        guards.set(`${path}.id`, drawing?.id); guards.set(`${path}.type`, drawing?.type);
        for (const key of keys) guards.set(`${path}.${key}`, (drawing as unknown as Record<string, unknown> | undefined)?.[key]);
        break;
      }
      default: return whole();
    }
  }
  return guards;
}

export function checkSpreadsheetCondition(workbook: SpreadsheetWorkbook, commands: readonly SpreadsheetCommand[],
  expected: SpreadsheetExpectedWorkbook | undefined, token?: SpreadsheetMutationToken): SpreadsheetCommandFailure | null {
  if (!expected) return null;
  const failed = (editConflicts: readonly ConditionalEditConflict[]): SpreadsheetCommandFailure => Object.freeze({
    ok: false, code: "PRECONDITION_FAILED", message: "取得後に対象が変更されました。最新の状態を取得して編集内容を確認してください", editConflicts });
  if (token) {
    if (!expected.token) return failed([{ path: "token", expected: null, actual: token }]);
    const conflicts = collectConditionalConflicts(expected.token, token, "token");
    if (conflicts.length) return failed(conflicts);
  }
  try {
    if (expected.scope === "workbook") {
      const conflicts = collectConditionalConflicts(expected.workbook, workbook, "workbook");
      return conflicts.length ? failed(conflicts) : null;
    }
    const before = dependencies(expected.workbook as SpreadsheetWorkbook, commands), current = dependencies(workbook, commands);
    const conflicts: ConditionalEditConflict[] = [];
    for (const [path, value] of before) {
      conflicts.push(...collectConditionalConflicts(value, current.get(path), path, 100 - conflicts.length));
      if (conflicts.length >= 100) break;
    }
    return conflicts.length ? failed(conflicts) : null;
  } catch (cause) {
    return Object.freeze({ ok: false, code: cause instanceof SpreadsheetCommandError ? cause.code : "INVALID_COMMAND",
      message: cause instanceof Error ? cause.message : "条件付き更新を確認できませんでした" });
  }
}

/** A monotonic session epoch protects positional edits even after insert/delete or Undo returns identical JSON. */
export function spreadsheetStructureChanged(before: SpreadsheetWorkbook, after: SpreadsheetWorkbook,
  commands?: readonly SpreadsheetCommand["type"][]): boolean {
  if (commands?.some(type => /^(rows\.(insert|delete)|columns\.(insert|delete)|sheets\.(add|delete|move|rename|duplicate)|cells\.(insert|delete|move|merge|unmerge))$/.test(type))) return true;
  return collectConditionalConflicts(workbookStructure(before), workbookStructure(after)).length > 0;
}
