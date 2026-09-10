import { applySpreadsheetCommands, createWorkbook, serializeWorkbook,
  type SpreadsheetApplyCommandsOptions, type SpreadsheetApplyCommandsResult,
  type SpreadsheetCommand, type SpreadsheetWorkbookSnapshot } from "../src/model-entry";

const workbook: SpreadsheetWorkbookSnapshot = createWorkbook();
const commands = [
  { type: "rows.insert", sheetId: "sheet-1", index: 2, count: 2 },
  { type: "cells.set", sheetId: "sheet-1", values: { A3: "商品A", B3: "100" } },
] as const satisfies readonly SpreadsheetCommand[];
const options: SpreadsheetApplyCommandsOptions = { features: { images: false } };
const result: SpreadsheetApplyCommandsResult = applySpreadsheetCommands(workbook, commands, options);
if (result.ok) {
  serializeWorkbook(result.workbook);
  const changed: boolean = result.changed;
  void changed;
} else {
  const index: number | undefined = result.commandIndex;
  void index;
  // @ts-expect-error failed batches never expose a partially modified workbook
  void result.workbook;
}
// @ts-expect-error cell values use the workbook's string input representation
applySpreadsheetCommands(workbook, [{ type: "cells.set", sheetId: "sheet-1", values: { A1: 10 } }]);
// @ts-expect-error unknown command types cannot be used by typed callers
applySpreadsheetCommands(workbook, [{ type: "cells.unknown", sheetId: "sheet-1" }]);
// @ts-expect-error unsupported options cannot silently bypass the command contract
applySpreadsheetCommands(workbook, [], { readOnly: true });
// @ts-expect-error feature flags are booleans
applySpreadsheetCommands(workbook, [], { features: { images: "false" } });
