import { cellAddress } from "../model/address";
import { normalizeDataValidation, type SpreadsheetDataValidation } from "../model/data-validation";
import { EXCEL_DATE_SERIAL_END, excelUtcFromSerial } from "../model/formatting/excel-date";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, readRange } from "./worksheet-shared";
import { finiteNumber } from "./drawing-geometry";
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
/** Expand supported rules sparsely and under the workbook's existing cell limit. */
export function readWorksheetValidations(node: XmlNode, initial: SpreadsheetSheet, context: ImportContext): SpreadsheetSheet {
  let sheet = initial;
  const cells: Record<string, SpreadsheetCell> = { ...sheet.cells };
  let count = Object.keys(cells).length, processed = 0;
  for (const item of children(child(node, "dataValidations"), "dataValidation")) {
    context.signal?.throwIfAborted();
    let rule: SpreadsheetDataValidation | undefined;
    try { rule = validationRule(item, context, sheet); } catch { rule = undefined; }
    if (!rule) { omitted(context, sheet, "未対応の入力規則を省略しました（数式・複雑な条件・許容型の警告など）"); continue; }
    const references = (item.attributes.sqref ?? "").trim().split(/\s+/), ranges = references.map(readRange);
    if (ranges.some(range => !range)) { omitted(context, sheet, "シート上限外または不正な範囲の入力規則を省略しました"); continue; }
    const size = ranges.reduce((sum, range) => sum + (range!.bottom - range!.top + 1) * (range!.right - range!.left + 1), 0);
    processed += size;
    if (processed > SPREADSHEET_LIMITS.cells) throw new Error("Excelの入力規則の対象セル数が上限を超えています");
    for (const range of ranges) {
      sheet = growSheet(sheet, range!.bottom, range!.right);
      for (let row = range!.top; row <= range!.bottom; row++) for (let column = range!.left; column <= range!.right; column++) {
        const address = cellAddress(row, column), previous = cells[address];
        if (!previous && ++count > SPREADSHEET_LIMITS.cells) throw new Error("Excelの入力規則を含むセル数が上限を超えています");
        cells[address] = { ...(previous ?? { value: "" }), validation: rule };
      }
    }
  }
  return { ...sheet, cells };
}
