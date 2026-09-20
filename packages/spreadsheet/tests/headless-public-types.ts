import { applySpreadsheetCommands, createWorkbook, serializeWorkbook, parseWorkbook, SPREADSHEET_FILE_VERSION,
  type SpreadsheetFile, type SpreadsheetFileRow, type SpreadsheetFileSheet,
  type SpreadsheetApplyCommandsOptions, type SpreadsheetApplyCommandsResult,
  type SpreadsheetCommand, type SpreadsheetCommandReceipt, type SpreadsheetCommandPlacement, type SpreadsheetInsertValue,
  type SpreadsheetWorkbookSnapshot } from "../src/model-entry";

const workbook: SpreadsheetWorkbookSnapshot = createWorkbook();
const nativeRow: SpreadsheetFileRow = { height: 28, cells: { A: { value: "商品" }, AA: { value: "右端" } } };
const nativeSheet: SpreadsheetFileSheet = { id: "sheet-1", name: "Sheet1", rowCount: 300, columnCount: 30, rows: [{}, nativeRow] };
const nativeFile: SpreadsheetFile = { format: "likex.spreadsheet", schemaVersion: SPREADSHEET_FILE_VERSION, sheets: [nativeSheet] };
const runtimeWorkbook: SpreadsheetWorkbookSnapshot = parseWorkbook(JSON.stringify(nativeFile));
// @ts-expect-error Native v2 rows are decoded before being passed to model commands.
applySpreadsheetCommands(nativeFile, []);
// @ts-expect-error Native rows are arrays, not a flat address map or one-based row map.
const invalidRows: SpreadsheetFileSheet["rows"] = { "1": nativeRow };
void [runtimeWorkbook, invalidRows];
const commands = [
  { type: "rows.insert", sheetId: "sheet-1", index: 2, count: 2 },
  { type: "rows.insert", sheetId: "sheet-1", index: 2, values: [["商品A", 100, true], ["商品B", 200, null]] },
  { type: "columns.insert", sheetId: "sheet-1", index: 1, values: [["価格", 100, 200], ["完了", false, true]] },
  { type: "cells.set", sheetId: "sheet-1", values: { A3: "商品A", B3: "100" } },
  { type: "shapes.insert", sheetId: "sheet-1", shape: "arrow", anchor: { row: 1, column: 1 }, flipX: true, flipY: false },
  { type: "textBoxes.insert", sheetId: "sheet-1", anchor: { row: 2, column: 1 }, flipY: true },
  { type: "images.insert", sheetId: "sheet-1", anchor: { row: 3, column: 1 }, flipX: true,
    resource: { name: "pixel.png", mimeType: "image/png", width: 1, height: 1, dataUrl: "data:image/png;base64,..." } },
] as const satisfies readonly SpreadsheetCommand[];
const insertionValue: SpreadsheetInsertValue = 100;
void insertionValue;
// @ts-expect-error insertion values require a matrix, even for a single row
applySpreadsheetCommands(workbook, [{ type: "rows.insert", sheetId: "sheet-1", index: 0, values: ["text", 1] }]);
// @ts-expect-error cell objects are not primitive insertion inputs
applySpreadsheetCommands(workbook, [{ type: "columns.insert", sheetId: "sheet-1", index: 0, values: [[{ value: "text" }]] }]);
// @ts-expect-error deletion does not accept insertion values
applySpreadsheetCommands(workbook, [{ type: "rows.delete", sheetId: "sheet-1", index: 0, values: [["text"]] }]);
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

const reflectionUpdates = [
  { type: "images.update", sheetId: "sheet-1", drawingId: "image", patch: { flipX: false, flipY: true } },
  { type: "shapes.update", sheetId: "sheet-1", drawingId: "shape", patch: { flipX: true } },
  { type: "textBoxes.update", sheetId: "sheet-1", drawingId: "text", patch: { flipY: false } },
] satisfies readonly SpreadsheetCommand[];
void reflectionUpdates;
// @ts-expect-error Reflection flags are boolean, not string-valued transforms.
applySpreadsheetCommands(workbook, [{ type: "shapes.insert", sheetId: "sheet-1", shape: "arrow", anchor: { row: 0, column: 0 }, flipX: "true" }]);
// @ts-expect-error Update patches use the same strict boolean reflection fields.
applySpreadsheetCommands(workbook, [{ type: "images.update", sheetId: "sheet-1", drawingId: "image", patch: { flipY: 1 } }]);
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
