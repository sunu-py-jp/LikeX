import { getCellFormat } from "../model/format-ranges";
import { cellAddress } from "../model/address";
import { isFormulaCell } from "../model/cell-value";
import { dataValidationError, normalizeDataValidation, type SpreadsheetDataValidation } from "../model/data-validation";
import { EXCEL_DATE_SERIAL_END, excelUtcFromSerial } from "../model/formatting/excel-date";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, readRange } from "./worksheet-shared";
import { finiteNumber } from "./drawing-geometry";
import { importFailureMessage, rethrowImportFailure } from "./recovery";
import type { ImportContext } from "./types";
import { child, children, spreadsheetText, textContent, type XmlNode } from "./xml";

function dateBound(value: number | undefined, context: ImportContext): string | undefined {
  if (value === undefined) return;
  const serial = value + (context.date1904 ? 1462 : 0);
  if (!Number.isInteger(serial) || serial < 1 || serial >= EXCEL_DATE_SERIAL_END || serial === 60) return;
  return new Date(excelUtcFromSerial(serial)).toISOString().slice(0, 10);
}
function validationRule(node: XmlNode, context: ImportContext, sheet: SpreadsheetSheet): SpreadsheetDataValidation | undefined {
  const { type, operator = "between", error, allowBlank, errorStyle, showErrorMessage } = node.attributes;
  // Excel warning/information rules permit invalid input. Importing these as strict rules would lock the sheet.
  if (errorStyle && errorStyle !== "stop" || showErrorMessage === "0" || showErrorMessage === "false") return;
  const common = { allowBlank: ["1", "true"].includes(allowBlank ?? "0"), ...(error ? { message: spreadsheetText(error).slice(0, 255) } : {}) };
  const first = spreadsheetText(textContent(child(node, "formula1"))).trim(), second = spreadsheetText(textContent(child(node, "formula2"))).trim();
  if (type === "list") {
    const literal = /^"((?:[^"]|"")*)"$/.exec(first);
    const values = literal ? literal[1].replace(/""/g, '"').split(",") : context.resolveListValues?.(first, sheet.name);
    if (!values || values.length > 1000) return;
    const seen = new Set<string>(), unique = values.filter(value => {
      if (!value || seen.has(value.toLocaleLowerCase("en-US"))) return false;
      seen.add(value.toLocaleLowerCase("en-US")); return true;
    });
    if (unique.length !== values.length) adjusted(context, sheet, "入力候補の空欄・重複を除きました");
    return normalizeDataValidation({ ...common, type: "list", values: unique });
  }
  if (!["whole", "decimal", "textLength", "date"].includes(type)) return;
  const a = finiteNumber(first), b = finiteNumber(second);
  if (a === undefined || !["between", "equal", "greaterThanOrEqual", "lessThanOrEqual", "greaterThan", "lessThan"].includes(operator)) return;
  const integer = type !== "decimal";
  if (!integer && ["greaterThan", "lessThan"].includes(operator)) return;
  let min: number | undefined, max: number | undefined;
  if (operator === "between") { if (b === undefined) return; min = a; max = b; }
  if (operator === "equal") min = max = a;
  if (operator === "greaterThanOrEqual") min = a;
  if (operator === "lessThanOrEqual") max = a;
  if (operator === "greaterThan") min = Math.floor(a) + 1;
  if (operator === "lessThan") max = Math.ceil(a) - 1;
  if (type === "date") {
    const start = dateBound(min, context), end = dateBound(max, context);
    if (min !== undefined && start === undefined || max !== undefined && end === undefined) return;
    return normalizeDataValidation({ ...common, type: "date", ...(start ? { min: start } : {}), ...(end ? { max: end } : {}) });
  }
  return normalizeDataValidation({ ...common, type: type === "textLength" ? "textLength" : "number",
    ...(type === "whole" ? { integer: true } : {}), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
}
/** Expand each supported rule atomically, reserving only newly materialized cells. */
export function readWorksheetValidations(node: XmlNode, initial: SpreadsheetSheet, context: ImportContext): SpreadsheetSheet {
  let sheet = initial;
  const cells: Record<string, SpreadsheetCell> = { ...sheet.cells };
  let count = Object.keys(cells).length, processed = 0;
  for (const item of children(child(node, "dataValidations"), "dataValidation")) {
    context.signal?.throwIfAborted();
    const reference = (item.attributes.sqref ?? "").slice(0, 160) || "範囲なし";
    const skip = (reason: string) => omitted(context, sheet, `入力規則「${reference}」を省略しました（${reason}、セルの値は保持）`);
    let rule: SpreadsheetDataValidation | undefined;
    try { rule = validationRule(item, context, sheet); }
    catch (error) {
      rethrowImportFailure(error, context);
      skip(importFailureMessage(error)); continue;
    }
    if (!rule) { skip("未対応の入力規則: 数式・複雑な条件・許容型の警告など"); continue; }
    const references = (item.attributes.sqref ?? "").trim().split(/\s+/), ranges = references.map(readRange);
    if (ranges.some(range => !range)) { skip("シート上限外または不正な範囲"); continue; }
    const size = ranges.reduce((sum, range) => sum + (range!.bottom - range!.top + 1) * (range!.right - range!.left + 1), 0);
    // A rejected huge rule consumes no iteration budget, so a later small rule can still be imported.
    if (size > SPREADSHEET_LIMITS.cells || processed + size > SPREADSHEET_LIMITS.cells) {
      skip(`対象セル数 ${size}、累計処理上限 ${SPREADSHEET_LIMITS.cells}`); continue;
    }
    processed += size;
    const addresses = new Set<string>(), updates = new Map<string, SpreadsheetCell | undefined>();
    let added = 0, removed = 0, invalid = 0, bottom = sheet.rowCount - 1, right = sheet.columnCount - 1;
    for (const range of ranges) {
      for (let row = range!.top; row <= range!.bottom; row++) {
        context.signal?.throwIfAborted();
        for (let column = range!.left; column <= range!.right; column++) {
          const address = cellAddress(row, column);
          if (addresses.has(address)) continue;
          addresses.add(address);
          const previous = cells[address];
          // Formula results need the completed workbook; literals and empty cells can
          // be checked now, before rejected rules consume capacity needed by later sheets.
          if (!isFormulaCell(previous) && dataValidationError(rule, previous?.value ?? "", undefined, getCellFormat(sheet, row, column))) {
            invalid++;
            if (previous?.validation) {
              if (previous.value === "" && !previous.format) { updates.set(address, undefined); removed++; }
              else updates.set(address, { value: previous.value, ...(previous.format ? { format: previous.format } : {}) });
            }
            continue;
          }
          if (!previous) added++;
          updates.set(address, { ...(previous ?? { value: "" }), validation: rule });
          bottom = Math.max(bottom, row); right = Math.max(right, column);
        }
      }
    }
    const remaining = Math.min(SPREADSHEET_LIMITS.cells - count, context.remainingExtraCells ?? SPREADSHEET_LIMITS.cells);
    if (added > remaining + removed) { skip(`追加セル数 ${added}、残り保存可能セル数 ${remaining}、解除で解放するセル数 ${removed}`); continue; }
    if (updates.size) sheet = growSheet(sheet, bottom, right);
    for (const [address, cell] of updates) {
      if (cell) cells[address] = cell;
      else delete cells[address];
    }
    count += added - removed;
    if (context.remainingExtraCells !== undefined) context.remainingExtraCells += removed - added;
    if (invalid) omitted(context, sheet, `入力規則「${reference}」のうち既存のセル値に適合しない入力規則を省略しました（セルの値は保持）`, invalid);
  }
  return { ...sheet, cells };
}
