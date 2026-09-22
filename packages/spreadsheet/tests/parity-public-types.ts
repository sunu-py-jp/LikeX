import type { SpreadsheetHandle, SpreadsheetSelectionApi, SpreadsheetSelectionOptions, SpreadsheetSelectedDrawing } from "../src";
import { createSpreadsheetTextMeasurer } from "../src";
import { createSpreadsheetAutoFitCommand, applySpreadsheetCommands, createWorkbook,
  type SpreadsheetTextMeasurer, type SpreadsheetAutoFitTarget, type SpreadsheetAutoFitOptions, type SpreadsheetCommand } from "../src/model-entry";

const workbook = createWorkbook();
const target: SpreadsheetAutoFitTarget = { sheetId: "sheet-1", axis: "column", indices: [0, 1] };
const measureText: SpreadsheetTextMeasurer = (text, format) => text.length * (format?.fontSize ?? 13);
const options: SpreadsheetAutoFitOptions = { measureText };
const command: SpreadsheetCommand = { type: "dimensions.autoFit", ...target };
applySpreadsheetCommands(workbook, [command, createSpreadsheetAutoFitCommand(workbook, target, options)]);
// @ts-expect-error Measurement functions are context, never serialized JSON command members.
const functionCommand: SpreadsheetCommand = { type: "dimensions.autoFit", ...target, measureText };
// @ts-expect-error Auto-fit requires explicit row/column indices.
createSpreadsheetAutoFitCommand(workbook, { sheetId: "sheet-1", axis: "row" });
void functionCommand;

function verifySelection(handle: SpreadsheetHandle, document: Document, root: Element) {
  const api: SpreadsheetSelectionApi = handle;
  const option: SpreadsheetSelectionOptions = { reveal: true };
  const results: boolean[] = [api.selectSheet("sheet-1"), api.selectCell("sheet-1", { row: 1, column: 2 }, option),
    api.selectRange("sheet-1", { anchor: { row: 0, column: 0 }, focus: { row: 2, column: 2 } }),
    api.selectRanges("sheet-1", api.getSelection().ranges ?? []), api.selectRows("sheet-1", 1, 3),
    api.selectColumns("sheet-1", 0), api.selectDrawing("sheet-1", "shape-1"), api.clearSelection(), api.revealSelection()];
  const selected: SpreadsheetSelectedDrawing | null = api.getSelectedDrawing();
  const browserMeasurement: SpreadsheetTextMeasurer = createSpreadsheetTextMeasurer(document, root);
  createSpreadsheetAutoFitCommand(handle.getWorkbook(), target, { measureText: browserMeasurement });
  // @ts-expect-error Reveal is an explicit boolean option.
  api.selectSheet("sheet-1", { reveal: "smooth" });
  // @ts-expect-error Selection positions use numeric row/column coordinates.
  api.selectCell("sheet-1", "A1");
  return { results, selected };
}
void verifySelection;
