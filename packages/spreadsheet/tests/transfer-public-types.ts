import { applySpreadsheetCommands, copySpreadsheetCells, createWorkbook, type SpreadsheetPastePayload,
  type SpreadsheetCommand, type SpreadsheetWorkbookSnapshot, type SpreadsheetCopyOptions } from "../src/model-entry";

const workbook: SpreadsheetWorkbookSnapshot = createWorkbook();
const range = { top: 0, left: 0, bottom: 1, right: 1 } as const;
const options: SpreadsheetCopyOptions = { kind: "copy", features: { comments: true } };
const payload: SpreadsheetPastePayload = copySpreadsheetCells(workbook, "sheet-1", range, options);
const commands = [
  { type: "cells.paste", sheetId: "sheet-1", target: { row: 2, column: 0 }, payload },
  { type: "cells.move", sheetId: "sheet-1", source: { sheetId: "sheet-1", ...range }, target: { row: 5, column: 0 } },
] as const satisfies readonly SpreadsheetCommand[];
const result = applySpreadsheetCommands(workbook, commands);
if (result.ok) for (const receipt of result.results) if (receipt.type === "cells.move") {
  const row: number = receipt.placement.nextRow, column: number = receipt.placement.nextColumn;
  void [row, column];
}
// @ts-expect-error captured values are readonly
payload.values[0][0] = "mutation";
// @ts-expect-error paste comments do not accept caller-chosen identities
const stolen: SpreadsheetPastePayload = { values: [[""]], comments: [[{ id: "stolen", text: "x" }]] };
// @ts-expect-error move source requires its explicit sheet
const missingSheet: SpreadsheetCommand = { type: "cells.move", sheetId: "sheet-1", source: range, target: { row: 3, column: 0 } };
// @ts-expect-error unsupported feature flags cannot be smuggled into copy options
copySpreadsheetCells(workbook, "sheet-1", range, { features: { invisible: true } });
void [stolen, missingSheet];
