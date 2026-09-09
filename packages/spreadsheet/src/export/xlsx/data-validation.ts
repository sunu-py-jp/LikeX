import type { SpreadsheetDataValidation } from "../../model/data-validation";
import { normalizeDataValidation } from "../../model/data-validation";
import type { SpreadsheetSheet } from "../../model/types";
import { xml, xlsxText } from "./xml";

export type XlsxValidationOptions = { formulaForList?: (values: readonly string[]) => string };
const excelMaximumNumber = 9.99999999999999e307;
const excelMinimumMagnitude = 2.2250738585072014e-308;

function listFormula(values: readonly string[], options: XlsxValidationOptions): string {
  if (options.formulaForList) return options.formulaForList(values);
  const inline = values.join(",");
  if (inline.length > 255 || values.some(value => /[,"\r\n]/.test(value))) throw new Error("この入力規則の選択肢をExcelへ出力するには、リスト用の参照範囲が必要です");
  return `"${inline}"`;
}

function dateSerial(value: string): number {
  if (value < "1900-01-01") throw new Error("Excelの日付入力規則は1900年以降の日付に対応しています");
  const days = (Date.parse(`${value}T00:00:00Z`) - Date.parse("1899-12-31T00:00:00Z")) / 86_400_000;
  return days + (value >= "1900-03-01" ? 1 : 0);
}

function rangeRule(type: string, min: number | undefined, max: number | undefined) {
  const operator = min !== undefined && max !== undefined ? "between" : min !== undefined ? "greaterThanOrEqual" : "lessThanOrEqual";
  return { type, operator, first: String(min ?? max ?? 0), ...(min !== undefined && max !== undefined ? { second: String(max) } : {}) };
}

function constraint(rule: SpreadsheetDataValidation, options: XlsxValidationOptions) {
  if (rule.type === "list" || rule.type === "checkbox") return { type: "list", first: listFormula(rule.type === "list" ? rule.values : ["TRUE", "FALSE"], options) };
  if (rule.type === "number") {
    for (const bound of [rule.min, rule.max]) if (bound !== undefined && (Math.abs(bound) > excelMaximumNumber ||
      (bound !== 0 && Math.abs(bound) < excelMinimumMagnitude)))
      throw new Error("入力規則の数値範囲をExcelで表現できません");
    return rangeRule(rule.integer ? "whole" : "decimal", rule.min ?? -excelMaximumNumber, rule.max ?? excelMaximumNumber);
  }
  if (rule.type === "textLength") return rangeRule("textLength", rule.min ?? 0, rule.max ?? 32767);
  return rangeRule("date", dateSerial(rule.min ?? "1900-01-01"), dateSerial(rule.max ?? "9999-12-31"));
}

/** Append after mergeCells and before drawing/legacyDrawing in worksheet schema order. */
export function dataValidationsXml(sheet: SpreadsheetSheet, options: XlsxValidationOptions = {}): string {
  const rules = Object.entries(sheet.cells).filter(([, cell]) => cell.validation);
  if (!rules.length) return "";
  const contents = rules.map(([address, cell]) => {
    const rule = normalizeDataValidation(cell.validation)!, spec = constraint(rule, options);
    return `<dataValidation type="${spec.type}"${"operator" in spec ? ` operator="${spec.operator}"` : ""} allowBlank="${rule.allowBlank === false ? 0 : 1}" showErrorMessage="1" errorStyle="stop" errorTitle="入力規則" error="${xlsxText(rule.message || "入力規則に合う値を入力してください")}" sqref="${xml(address)}"><formula1>${xml(spec.first)}</formula1>${"second" in spec ? `<formula2>${xml(spec.second!)}</formula2>` : ""}</dataValidation>`;
  }).join("");
  return `<dataValidations count="${rules.length}">${contents}</dataValidations>`;
}
