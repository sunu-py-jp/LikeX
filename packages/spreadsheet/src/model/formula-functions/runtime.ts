import { SPREADSHEET_LIMITS, type SpreadsheetCalculatedValue as Value } from "../types";

export class FormulaError extends Error { constructor(readonly code: string) { super(code); } }
export const fail = (code = "#ERROR!"): never => { throw new FormulaError(code); };
export const errorPattern = /^#(?:NULL!|REF!|DIV\/0!|VALUE!|NAME\?|NUM!|N\/A|CYCLE!|LIMIT!|ERROR!)/;
export const recoverableErrors = new Set(["#NULL!", "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!", "#N/A"]);
export function finite(value: number): number { return Number.isFinite(value) ? value : fail("#NUM!"); }
export function checked(value: Value): Value {
  if (typeof value === "string" && errorPattern.test(value) && errorPattern.exec(value)![0] === value) return fail(value);
  return value;
}
export function number(value: Value): number {
  checked(value);
  if (typeof value === "number") return finite(value);
  if (typeof value === "boolean") return Number(value);
  if (!value.trim()) return 0;
  return numeric.test(value.trim()) ? finite(Number(value)) : fail("#VALUE!");
}
export const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function literal(value: string): Value {
  if (value.startsWith("'")) return value.slice(1);
  if (numeric.test(value.trim())) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : value; }
  if (/^(true|false)$/i.test(value)) return value.toUpperCase() === "TRUE";
  return value;
}

export function logical(value: Value): boolean {
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) return value.trim().toUpperCase() === "TRUE";
  return number(value) !== 0;
}
export function text(value: Value): string { return typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value); }

/** Round decimal digits, avoiding binary multiplication's 1.005 * 100 boundary error. */
export function round(value: number, places: number, mode: "nearest" | "up" | "down" = "nearest"): number {
  const digits = Math.trunc(places);
  const [coefficient, power = "0"] = Math.abs(value).toString().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  const significant = coefficient.replace(".", "");
  const remove = fraction - Number(power) - digits;
  if (remove <= 0 || value === 0) return value === 0 ? 0 : value;
  if (remove > significant.length) return mode === "up" ? finite(Math.sign(value) * Number(`1e${-digits}`)) : 0;
  const boundary = significant.length - remove;
  let rounded = BigInt(significant.slice(0, boundary) || "0");
  if (mode === "nearest" ? significant[boundary] >= "5" : mode === "up" && /[1-9]/.test(significant.slice(boundary))) rounded++;
  if (!rounded) return 0;
  return finite(Math.sign(value) * Number(`${rounded}e${-digits}`));
}


/** null is an actual empty cell, distinct from a formula returning an empty string. */
export interface FormulaRange {
  readonly values: (Value | null)[];
  at(index: number): Value | null;
  rows: number;
  columns: number;
  row: number;
  column: number;
}
/** Evaluation stays owned by the workbook; handlers cannot bypass its resource budget. */
export interface FunctionContext {
  count: number;
  position: { row: number; column: number };
  scalar(index: number): Value;
  raw(index: number): Value | null;
  text(index: number): string;
  range(index: number): FormulaRange;
  criterion(index: number): Value;
  values(index: number): (Value | null)[];
  referenced(index: number): boolean;
  omitted(index: number): boolean;
  checkArity(minimum: number, maximum?: number): void;
  tick(cost?: number): void;
}
export type FunctionHandler = (context: FunctionContext) => Value;
export function countable(value: Value): Value {
  return typeof value === "string" && recoverableErrors.has(value) ? value : checked(value);
}
export function boundedText(value: string): string {
  return value.length > SPREADSHEET_LIMITS.cellLength ? fail("#LIMIT!") : value;
}
export function appendText(before: string, after: string): string {
  if (before.length + after.length > SPREADSHEET_LIMITS.cellLength) return fail("#LIMIT!");
  return before + after;
}
export function compareValues(a: Value, b: Value): number {
  checked(a); checked(b);
  const rank = (value: Value) => typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2;
  if (typeof a !== typeof b) return rank(a) - rank(b);
  const left = typeof a === "string" ? a.toLocaleLowerCase("en-US") : a;
  const right = typeof b === "string" ? b.toLocaleLowerCase("en-US") : b;
  return left === right ? 0 : left < right ? -1 : 1;
}
export function integerArgument(context: FunctionContext, index: number, fallback?: number): number {
  return context.omitted(index) && fallback !== undefined ? fallback : Math.trunc(number(context.scalar(index)));
}
