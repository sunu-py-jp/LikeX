import { applySpreadsheetCommands, createWorkbook, serializeWorkbook,
  type SpreadsheetApplyCommandsOptions, type SpreadsheetApplyCommandsResult,
  type SpreadsheetCommand, type SpreadsheetCommandReceipt, type SpreadsheetCommandPlacement,
  type SpreadsheetWorkbookSnapshot } from "../src/model-entry";

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

function verifyReceiptTypes(receipt: SpreadsheetCommandReceipt) {
  // Existing generic receipt consumers can still inspect optional identifiers without narrowing.
  const optionalId: string | undefined = receipt.drawingId;
  void optionalId;
  if (receipt.type === "images.insert" || receipt.type === "images.update") {
    const placement: SpreadsheetCommandPlacement = receipt.placement;
    const drawingId: string = receipt.drawingId;
    const resourceId: string = receipt.resourceId;
    void [placement, drawingId, resourceId];
    // @ts-expect-error published placement is immutable
    receipt.placement.nextRow = 5;
  }
  if (receipt.type === "cells.fill" || receipt.type === "shapes.insert" || receipt.type === "shapes.update"
    || receipt.type === "textBoxes.insert" || receipt.type === "textBoxes.update") {
    const nextRow: number = receipt.placement.nextRow;
    const nextColumn: number = receipt.placement.nextColumn;
    void [nextRow, nextColumn];
  }
  if (receipt.type === "cells.set" || receipt.type === "cells.paste") {
    const optional: SpreadsheetCommandPlacement | undefined = receipt.placement;
    void optional;
    // @ts-expect-error empty targets have no placement
    const required: SpreadsheetCommandPlacement = receipt.placement;
    void required;
  }
  if (receipt.type === "rows.insert") {
    const row: number = receipt.placement.nextRow;
    // @ts-expect-error row insertion does not expose a usable next column
    const column: number = receipt.placement.nextColumn;
    void [row, column];
  }
  if (receipt.type === "columns.insert") {
    const column: number = receipt.placement.nextColumn;
    // @ts-expect-error column insertion does not expose a usable next row
    const row: number = receipt.placement.nextRow;
    void [row, column];
  }
  if (receipt.type === "rows.delete" || receipt.type === "cells.format" || receipt.type === "sheets.add") {
    const absent: undefined = receipt.placement;
    // @ts-expect-error non-positional commands have no placement
    void receipt.placement.nextRow;
    void absent;
  }
}
void verifyReceiptTypes;
