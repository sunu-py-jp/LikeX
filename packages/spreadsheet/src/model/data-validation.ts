import { calculateWorkbook } from "./formula";
import { cellTextValue, isFormulaCell, isFormulaValue } from "./cell-value";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetCalculatedValue, type SpreadsheetWorkbook } from "./types";

type ValidationOptions = { /** Empty cells are allowed unless explicitly false. */ allowBlank?: boolean; message?: string };
/** Persisted cell rules. Values remain strings; date rules accept ISO calendar dates. */
export type SpreadsheetDataValidation = Readonly<ValidationOptions & (
  | { type: "list"; values: readonly string[] }
  | { type: "number"; integer?: boolean; min?: number; max?: number }
  | { type: "textLength"; min?: number; max?: number }
  | { type: "date"; min?: string; max?: string }
  | { type: "checkbox" }
)>;

const fail = (message: string): never => { throw new Error(message); };
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const normalized = new WeakSet<object>();
const ruleKeys = { list: ["values"], number: ["integer", "min", "max"], textLength: ["min", "max"], date: ["min", "max"], checkbox: [] };
export function isIsoCalendarDate(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeDataValidation(input: SpreadsheetDataValidation | undefined): SpreadsheetDataValidation | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("入力規則が正しくありません");
  if (normalized.has(input)) return input;
  if (!Object.hasOwn(ruleKeys, input.type)) return fail("入力規則の種類が正しくありません");
  const allowed = ["type", "allowBlank", "message", ...ruleKeys[input.type]];
  if (Object.keys(input).some(key => !allowed.includes(key))) return fail("入力規則に未対応のプロパティがあります");
  if (input.allowBlank !== undefined && typeof input.allowBlank !== "boolean") return fail("空白の許可は true または false で指定してください");
  if (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 255)) return fail("入力規則のメッセージは255文字以内で指定してください");
  const common = { ...(input.allowBlank !== undefined ? { allowBlank: input.allowBlank } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}) };
  let result: SpreadsheetDataValidation;
  if (input.type === "list") {
    if (!Array.isArray(input.values) || !input.values.length || input.values.length > 1000 || Array.from(input.values).some(value =>
      typeof value !== "string" || !value || value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)))
      return fail("リストには1〜1,000件の空でない文字列を指定してください（各1,000文字以内）");
    if (input.values.reduce((size, value) => size + value.length, 0) > 100_000) return fail("リストの選択肢の合計は100,000文字以内で指定してください");
    const unique = new Set(input.values.map(value => value.toLocaleLowerCase("en-US")));
    if (unique.size !== input.values.length) return fail("リストの選択肢が重複しています");
    result = { type: "list", values: Object.freeze([...input.values]), ...common };
  } else if (input.type === "number" || input.type === "textLength") {
    for (const bound of [input.min, input.max]) if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) ||
      (input.type === "textLength" && (!Number.isInteger(bound) || bound < 0 || bound > SPREADSHEET_LIMITS.cellLength))))
      return fail("入力規則の最小値・最大値が正しくありません");
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) return fail("最小値は最大値以下で指定してください");
    if (input.type === "number" && input.integer !== undefined && typeof input.integer !== "boolean") return fail("整数の指定は true または false で指定してください");
    result = { type: input.type, ...(input.min !== undefined ? { min: input.min } : {}), ...(input.max !== undefined ? { max: input.max } : {}),
      ...(input.type === "number" && input.integer !== undefined ? { integer: input.integer } : {}), ...common };
  } else if (input.type === "date") {
    if ((input.min !== undefined && !isIsoCalendarDate(input.min)) || (input.max !== undefined && !isIsoCalendarDate(input.max)))
      return fail("日付の範囲は YYYY-MM-DD の有効な日付で指定してください");
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) return fail("開始日は終了日以前で指定してください");
    result = { type: "date", ...(input.min !== undefined ? { min: input.min } : {}), ...(input.max !== undefined ? { max: input.max } : {}), ...common };
  } else result = { type: "checkbox", ...common };
  Object.freeze(result); normalized.add(result); return result;
}

export function dataValidationsEqual(a: SpreadsheetDataValidation | undefined, b: SpreadsheetDataValidation | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type || (a.allowBlank !== false) !== (b.allowBlank !== false) || (a.message ?? "") !== (b.message ?? "")) return false;
  if (a.type === "list" && b.type === "list") return a.values.length === b.values.length && a.values.every((value, index) => value === b.values[index]);
  if (a.type === "number" && b.type === "number") return !!a.integer === !!b.integer && a.min === b.min && a.max === b.max;
  if (a.type === "textLength" && b.type === "textLength") return (a.min ?? 0) === (b.min ?? 0) && (a.max ?? SPREADSHEET_LIMITS.cellLength) === (b.max ?? SPREADSHEET_LIMITS.cellLength);
  if (a.type === "date" && b.type === "date") return a.min === b.min && a.max === b.max;
  return a.type === "checkbox" && b.type === "checkbox";
}

const stringValue = (value: SpreadsheetCalculatedValue) => typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
/** Returns a human-readable rejection, without changing the draft or coercing user input. */
export function dataValidationError(rule: SpreadsheetDataValidation, raw: string, calculated?: SpreadsheetCalculatedValue, format?: SpreadsheetCellFormat): string | null {
  const value = isFormulaValue(raw, format) ? calculated : cellTextValue(raw);
  const display = value === undefined ? "" : stringValue(value);
  if (display === "") return rule.allowBlank !== false ? null : rule.message || "空白は許可されていません";
  let valid = false;
  switch (rule.type) {
    case "list": valid = rule.values.some(item => item.toLocaleLowerCase("en-US") === display.toLocaleLowerCase("en-US")); break;
    case "checkbox": valid = /^(true|false)$/i.test(display); break;
    case "number": {
      const value = numberPattern.test(display) ? Number(display) : NaN;
      valid = Number.isFinite(value) && (!rule.integer || Number.isInteger(value)) && (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max);
      break;
    }
    case "textLength": { const length = [...display].length; valid = length >= (rule.min ?? 0) && length <= (rule.max ?? SPREADSHEET_LIMITS.cellLength); break; }
    case "date": valid = isIsoCalendarDate(display) && (rule.min === undefined || display >= rule.min) && (rule.max === undefined || display <= rule.max); break;
  }
  return valid ? null : rule.message || { list: "リストの選択肢から入力してください", number: "指定された数値の範囲で入力してください",
    textLength: "指定された文字数の範囲で入力してください", date: "指定された日付の範囲で入力してください", checkbox: "チェックボックスには TRUE または FALSE を入力してください" }[rule.type];
}

const ruleCells = new WeakMap<object, readonly [string, SpreadsheetCell & { validation: SpreadsheetDataValidation } ][]>();
/** Every mutation validates a complete candidate. Hidden controls never disable persisted rules. */
export function assertWorkbookDataValidation(workbook: SpreadsheetWorkbook): void {
  const entries = workbook.sheets.flatMap(sheet => {
    let cells = ruleCells.get(sheet.cells);
    if (!cells) {
      cells = Object.entries(sheet.cells).filter((entry): entry is [string, SpreadsheetCell & { validation: SpreadsheetDataValidation }] => !!entry[1].validation);
      if (Object.isFrozen(sheet.cells)) ruleCells.set(sheet.cells, cells);
    }
    return cells.map(([address, cell]) => ({ sheet, address, cell }));
  });
  if (!entries.length) return;
  const calculated = entries.some(({ cell }) => isFormulaCell(cell)) ? calculateWorkbook(workbook) : undefined;
  for (const { sheet, address, cell } of entries) {
    const rule = normalizeDataValidation(cell.validation)!;
    const computed = calculated?.[sheet.id]?.[address];
    if (isFormulaCell(cell) && (computed === undefined || (typeof computed === "string" && /^#(?:LIMIT|CYCLE|ERROR|REF|VALUE|DIV\/0|NAME|N\/A|NUM|NULL)/.test(computed))))
      return fail(`${sheet.name}!${address}: 計算結果を入力規則で検証できません`);
    const error = dataValidationError(rule, cell.value, computed, cell.format);
    if (error) return fail(`${sheet.name}!${address}: ${error}`);
  }
}
