import type { SpreadsheetCellFormat } from "../../model/types";

export function displayCell(value: string | number | boolean | undefined, format?: SpreadsheetCellFormat) {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number" || !format?.numberFormat || format.numberFormat === "general") return String(value);
  if (format.numberFormat === "percent") return new Intl.NumberFormat("ja-JP", { style: "percent", maximumFractionDigits: 2 }).format(value);
  if (format.numberFormat === "currency") return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}
