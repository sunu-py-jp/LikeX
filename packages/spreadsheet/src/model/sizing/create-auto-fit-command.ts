import type { SpreadsheetWorkbookSnapshot } from "../../commands/types";
import type { SpreadsheetFormattingCommand } from "../../api/formatting-commands";
import { calculateWorkbook } from "../formula";
import { normalizeWorkbook } from "../workbook/normalize";
import type { SpreadsheetWorkbook } from "../types";
import { autoFitDimensions } from "./auto-fit";
import { DEFAULT_CELL_MEASUREMENT, estimateTextWidth, type TextMeasurer } from "./text-measurer";

export type SpreadsheetAutoFitTarget = Readonly<{ sheetId: string; axis: "row" | "column"; indices: readonly number[] }>;
export type SpreadsheetAutoFitOptions = Readonly<{
  /** Logical CSS pixels. Omit for a deterministic estimate independent of DOM/fonts installed on the host. */
  measureText?: TextMeasurer;
}>;
export type SpreadsheetAutoFitCommand = Extract<SpreadsheetFormattingCommand, { type: "dimensions.resize" }>;

/** Shared calculation for validated command workbooks and the public helper. */
export function autoFitCommandForWorkbook(workbook: SpreadsheetWorkbook, target: SpreadsheetAutoFitTarget,
  options: SpreadsheetAutoFitOptions = {}): SpreadsheetAutoFitCommand {
  if (!target || typeof target !== "object" || !["row", "column"].includes(target.axis) ||
    typeof target.sheetId !== "string" || Object.keys(target).some(key => !["sheetId", "axis", "indices"].includes(key)))
    throw new Error("自動調整の対象が正しくありません");
  const sheet = workbook.sheets.find(item => item.id === target.sheetId);
  if (!sheet) throw new Error("対象のシートがありません");
  const count = target.axis === "row" ? sheet.rowCount : sheet.columnCount;
  if (!Array.isArray(target.indices) || !target.indices.length || target.indices.length > count ||
    Array.from(target.indices).some(index => !Number.isInteger(index) || index < 0 || index >= count))
    throw new Error("自動調整の行列番号が範囲外です");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "measureText") ||
    (options.measureText !== undefined && typeof options.measureText !== "function"))
    throw new Error("自動調整の計測オプションが正しくありません");
  const source = options.measureText ?? estimateTextWidth;
  const measure: TextMeasurer = (text, format) => {
    const width = source(text, format);
    if (!Number.isFinite(width) || width < 0) throw new Error("文字幅は0以上の有限の数値で返してください");
    return width;
  };
  if (source.cellStyle) {
    const style = source.cellStyle;
    for (const key of Object.keys(DEFAULT_CELL_MEASUREMENT) as (keyof typeof DEFAULT_CELL_MEASUREMENT)[]) {
      const value = style[key];
      if (typeof value !== typeof DEFAULT_CELL_MEASUREMENT[key] || (typeof value === "number" && (!Number.isFinite(value) ||
        (value < 0 && key !== "letterSpacing" && key !== "wordSpacing") || ((key === "fontSize" || key === "lineHeight") && value === 0))))
        throw new Error("セルの計測スタイルが正しくありません");
    }
    measure.cellStyle = { ...style };
  }
  const sizes = Object.freeze(Object.fromEntries(autoFitDimensions(sheet, target.axis, new Set(target.indices),
    calculateWorkbook(workbook)[sheet.id] ?? {}, measure)));
  return Object.freeze({ type: "dimensions.resize", sheetId: sheet.id,
    ...(target.axis === "row" ? { rowHeights: sizes } : { columnWidths: sizes }) });
}

/** Compute content-fitting sizes without changing the workbook; apply the returned command through a session/ref. */
export function createSpreadsheetAutoFitCommand(workbook: SpreadsheetWorkbookSnapshot, target: SpreadsheetAutoFitTarget,
  options?: SpreadsheetAutoFitOptions): SpreadsheetAutoFitCommand {
  if (workbook === undefined) throw new Error("操作するブックを指定してください");
  return autoFitCommandForWorkbook(normalizeWorkbook(workbook as SpreadsheetWorkbook), target, options);
}
