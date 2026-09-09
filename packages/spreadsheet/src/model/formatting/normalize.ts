import type { SpreadsheetCellFormat } from "../types";
import type { SpreadsheetCellBorders } from "./types";

const fail = (message: string): never => { throw new Error(message); };
export function validateFormatColor(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || /[;{}<>\u0000-\u001f]/.test(value)) return fail("セルの色が正しくありません");
  return value;
}
export function normalizeCellFormat(value: SpreadsheetCellFormat | undefined): SpreadsheetCellFormat | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("セルの書式が正しくありません");
  const result: SpreadsheetCellFormat = {};
  for (const key of ["bold", "italic", "underline", "wrap", "useGrouping"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "boolean") return fail("セルの書式が正しくありません");
    result[key] = value[key];
  }
  for (const key of ["color", "background"] as const) if (value[key] !== undefined) {
    const color = validateFormatColor(value[key]); if (color) result[key] = color;
  }
  const choices = { align: ["left", "center", "right"], verticalAlign: ["top", "middle", "bottom"],
    numberFormat: ["general", "number", "currency", "percent", "date", "time", "datetime"],
    negativeFormat: ["minus", "parentheses", "red", "red-parentheses"] } as const;
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) if (value[key] !== undefined) {
    if (!(choices[key] as readonly unknown[]).includes(value[key])) return fail("セルの書式が正しくありません");
    Object.assign(result, { [key]: value[key] });
  }
  if (value.fontFamily !== undefined) {
    if (typeof value.fontFamily !== "string" || !value.fontFamily.trim() || value.fontFamily.length > 100 || /[;{}<>\u0000-\u001f]/.test(value.fontFamily)) return fail("フォント名が正しくありません");
    result.fontFamily = value.fontFamily.trim();
  }
  if (value.fontSize !== undefined) {
    if (!Number.isFinite(value.fontSize) || value.fontSize < 1 || value.fontSize > 200) return fail("フォントサイズは1〜200pxで指定してください");
    result.fontSize = value.fontSize;
  }
  if (value.decimalPlaces !== undefined) {
    if (!Number.isInteger(value.decimalPlaces) || value.decimalPlaces < 0 || value.decimalPlaces > 10) return fail("小数桁数は0〜10で指定してください");
    result.decimalPlaces = value.decimalPlaces;
  }
  if (value.borders !== undefined) {
    if (!value.borders || typeof value.borders !== "object" || Array.isArray(value.borders)) return fail("罫線が正しくありません");
    const borders: Partial<Record<keyof SpreadsheetCellBorders, object>> = {};
    for (const key of Object.keys(value.borders)) if (!["top", "right", "bottom", "left"].includes(key)) return fail("罫線の辺が正しくありません");
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const border = value.borders[edge]; if (border === undefined) continue;
      if (!border || typeof border !== "object" || Array.isArray(border) || (border.style !== undefined && !["none", "solid", "dashed", "dotted", "double"].includes(border.style)) || (border.width !== undefined && ![1, 2, 3].includes(border.width))) return fail("罫線が正しくありません");
      borders[edge] = Object.freeze({ ...(border.style !== undefined ? { style: border.style } : {}), ...(border.width !== undefined ? { width: border.width } : {}), ...(border.color !== undefined ? { color: validateFormatColor(border.color) } : {}) });
    }
    // An explicit empty map is retained, allowing a formatting patch to clear all edges.
    result.borders = Object.freeze(borders);
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}
function canonical(format: SpreadsheetCellFormat | undefined) {
  return { ...format, bold: !!format?.bold, italic: !!format?.italic, underline: !!format?.underline,
    wrap: !!format?.wrap, verticalAlign: format?.verticalAlign ?? "middle", numberFormat: format?.numberFormat ?? "general",
    negativeFormat: format?.negativeFormat ?? "minus", borders: ["top", "right", "bottom", "left"].map(edge => {
      const border = format?.borders?.[edge as keyof SpreadsheetCellBorders];
      return !border || border.style === "none" ? null : { style: border.style ?? "solid", width: border.width ?? 1, color: border.color ?? "#808080" };
    }) };
}
export function formatsEqual(left: SpreadsheetCellFormat | undefined, right: SpreadsheetCellFormat | undefined): boolean {
  if (left === right) return true;
  const a = canonical(left), b = canonical(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => JSON.stringify(a[key as keyof typeof a]) === JSON.stringify(b[key as keyof typeof b]));
}
