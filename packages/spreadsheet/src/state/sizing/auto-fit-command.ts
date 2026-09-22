import type { SpreadsheetCommand } from "../../api/types";
import type { SpreadsheetWorkbook, SpreadsheetCalculatedValue } from "../../model/types";
import { createSpreadsheetAutoFitCommand } from "../../model/sizing/create-auto-fit-command";
import { createTextMeasurer } from "./text-measurer";

/** Browser adapter; toolbar, header menus and public helpers share the content calculation. */
export function autoFitCommand(workbook: SpreadsheetWorkbook, sheetId: string, axis: "row" | "column",
  indices: Iterable<number>, document: Document, _values?: Readonly<Record<string, SpreadsheetCalculatedValue>>, source?: Element | null): SpreadsheetCommand {
  return createSpreadsheetAutoFitCommand(workbook, { sheetId, axis, indices: [...new Set(indices)] },
    { measureText: createTextMeasurer(document, source) });
}
