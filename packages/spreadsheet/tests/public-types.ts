import type {
  SpreadsheetCell,
  SpreadsheetCellFormat,
  SpreadsheetFeatures,
  SpreadsheetProps,
  SpreadsheetSaveHandler,
  SpreadsheetSelection,
  SpreadsheetSelectionRange,
  SpreadsheetWorkbook,
  SpreadsheetDrawing,
  SpreadsheetDrawingPatch,
  SpreadsheetImageResource,
  SpreadsheetMergedRange,
  SpreadsheetCommand, SpreadsheetHandle, SpreadsheetCommandResult, SpreadsheetWorkbookSnapshot,
} from "../src";
import { createRef } from "react";
import { prepareSpreadsheetImage } from "../src";

const cell: SpreadsheetCell = { value: "=SUM(A1:A10)", format: { numberFormat: "currency", bold: true } };
const workbook: SpreadsheetWorkbook = { sheets: [{ id: "main", name: "Sheet1", rowCount: 100, columnCount: 26, cells: { B1: cell } }] };
const save: SpreadsheetSaveHandler = async (value) => value;
const features = { sheets: false, formulas: false, clipboard: true, images: true, shapes: false, textBoxes: true, comments: true, mergeCells: false } satisfies SpreadsheetFeatures;
const props: SpreadsheetProps = {
  initialWorkbook: workbook, onSave: save, features, colorMode: "system", title: "資料",
  onChange(value) { void value.sheets[0].cells.A1?.value; },
  onSelectionChange(selection: SpreadsheetSelection) { void selection.focus.row; },
};

// @ts-expect-error Unsupported features must be rejected by the public API.
const invalidFeature: SpreadsheetFeatures = { macros: true };
// @ts-expect-error Alignment is a closed union, not arbitrary CSS.
const invalidFormat: SpreadsheetCellFormat = { align: "sideways" };
// @ts-expect-error Cells retain raw input as text, including formulas.
const invalidCell: SpreadsheetCell = { value: 42 };
// @ts-expect-error Save returns a complete normalized workbook or no value.
const invalidSave: SpreadsheetSaveHandler = () => ({ success: true });
// @ts-expect-error The color mode must be one of the supported modes.
const invalidMode: SpreadsheetProps = { colorMode: "auto" };

void [props, invalidFeature, invalidFormat, invalidCell, invalidSave, invalidMode];

const drawing: SpreadsheetDrawing = { id: "box", type: "text", text: "メモ", fontSize: 16, color: "#333333", background: "transparent", anchor: { row: 1, column: 2, offsetX: 0, offsetY: 8 }, width: 220, height: 100 };
const drawingPatch: SpreadsheetDrawingPatch = { width: 240, text: "修正" };
// @ts-expect-error The stable identity cannot be changed by a drawing patch.
const invalidDrawingPatch: SpreadsheetDrawingPatch = { id: "replacement" };
// @ts-expect-error Images cannot hold active SVG content.
const invalidImageType: SpreadsheetImageResource["mimeType"] = "image/svg+xml";
// @ts-expect-error Known format versions are explicit.
const invalidVersion: SpreadsheetWorkbook = { schemaVersion: 2, sheets: [] };
void [drawing, drawingPatch, invalidDrawingPatch, invalidImageType, invalidVersion];

const range: SpreadsheetSelectionRange = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
const legacySelection: SpreadsheetSelection = { sheetId: "main", ...range };
const multipleSelection: SpreadsheetSelection = { ...legacySelection, ranges: [range] };
function inspectSelection(selection: SpreadsheetSelection) {
  const ranges: readonly SpreadsheetSelectionRange[] = selection.ranges ?? [selection];
  // @ts-expect-error Selection ranges are readonly snapshots.
  ranges.push(range);
  // @ts-expect-error Range positions cannot be changed through callbacks.
  ranges[0].anchor.row = 3;
}
void [multipleSelection, inspectSelection];

const mergedRange: SpreadsheetMergedRange = { top: 0, left: 0, bottom: 1, right: 2 };
const mergedWorkbook: SpreadsheetWorkbook = { sheets: [{ ...workbook.sheets[0], cells: {}, merges: [mergedRange] }] };
// @ts-expect-error Merged geometry is a readonly snapshot.
mergedRange.right = 3;
// @ts-expect-error Merged-range collections cannot be mutated through the workbook.
mergedWorkbook.sheets[0].merges?.push(mergedRange);
// @ts-expect-error Feature flags are strict booleans.
const invalidMergeFeature: SpreadsheetFeatures = { mergeCells: "yes" };
void [mergedWorkbook, invalidMergeFeature];

const apiRef = createRef<SpreadsheetHandle>();
const apiProps: SpreadsheetProps = { ref: apiRef, onSave: save };
const commands: readonly SpreadsheetCommand[] = [
  { type: "cells.set", sheetId: "main", values: { A1: "1200", B1: "=A1*2" } },
  { type: "rows.insert", sheetId: "main", index: 4, count: 2 },
  { type: "shapes.insert", sheetId: "main", shape: "rectangle", anchor: { row: 4, column: 1 } },
];
function inspectApi(api: SpreadsheetHandle) {
  const result: SpreadsheetCommandResult = api.batch(commands);
  if (result.ok) { void result.changed; void result.results[0]?.drawingId; }
  else { void result.code; void result.commandIndex; }
  const snapshot: SpreadsheetWorkbookSnapshot = api.getWorkbook();
  // @ts-expect-error Snapshot cells are deeply readonly.
  snapshot.sheets[0].cells.A1.value = "changed";
  // @ts-expect-error Host operations cannot mutate sheet metadata through a snapshot.
  snapshot.sheets[0].name = "changed";
  // @ts-expect-error Each command requires its own target and payload.
  api.execute({ type: "cells.set", values: { A1: "1" } });
  // @ts-expect-error Commands are data, not arbitrary workbook updater functions.
  api.batch(() => []);
  // @ts-expect-error Numeric cell input must use the existing string representation.
  api.execute({ type: "cells.set", sheetId: "main", values: { A1: 42 } });
  // @ts-expect-error Image patches cannot accept text-box fields.
  api.execute({ type: "images.update", sheetId: "main", drawingId: "logo", patch: { text: "wrong" } });
  // @ts-expect-error Stable object IDs cannot be changed by a patch.
  api.execute({ type: "shapes.update", sheetId: "main", drawingId: "box", patch: { id: "other" } });
}
const prepareBlob = (blob: Blob, signal: AbortSignal): Promise<SpreadsheetImageResource> => prepareSpreadsheetImage(blob, { name: "logo.png", signal });
// @ts-expect-error Image retrieval and authentication belong to the host, not a URL-taking helper.
const invalidImageSource = () => prepareSpreadsheetImage("https://example.invalid/logo.png");
void [apiProps, inspectApi, prepareBlob, invalidImageSource];
