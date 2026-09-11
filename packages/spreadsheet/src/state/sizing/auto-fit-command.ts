import type { SpreadsheetCommand } from "../../api/types";
import type { SpreadsheetWorkbook, SpreadsheetCalculatedValue } from "../../model/types";
import { calculateWorkbook } from "../../model";
import { autoFitDimensions, createTextMeasurer } from "./auto-fit";

/** Toolbar and header menus share measurement and the same dimensions command. */
export function autoFitCommand(workbook: SpreadsheetWorkbook, sheetId: string, axis: "row" | "column",
  indices: Iterable<number>, document: Document, values?: Readonly<Record<string, SpreadsheetCalculatedValue>>): SpreadsheetCommand {
  const sheet = workbook.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error("対象のシートがありません");
  const sizes = Object.fromEntries(autoFitDimensions(sheet, axis, new Set(indices), values ?? calculateWorkbook(workbook)[sheetId] ?? {}, createTextMeasurer(document)));
  return {type: "dimensions.resize", sheetId, ...(axis === "row" ? {rowHeights: sizes} : {columnWidths: sizes})};
}
