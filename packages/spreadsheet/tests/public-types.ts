import type {
  SpreadsheetCell,
  SpreadsheetCellFormat,
  SpreadsheetFeatures,
  SpreadsheetProps,
  SpreadsheetSaveHandler,
  SpreadsheetSelection,
  SpreadsheetWorkbook,
  SpreadsheetDrawing,
  SpreadsheetDrawingPatch,
  SpreadsheetImageResource,
} from "../src";

const cell: SpreadsheetCell = { value: "=SUM(A1:A10)", format: { numberFormat: "currency", bold: true } };
const workbook: SpreadsheetWorkbook = { sheets: [{ id: "main", name: "Sheet1", rowCount: 100, columnCount: 26, cells: { B1: cell } }] };
const save: SpreadsheetSaveHandler = async (value) => value;
const features = { sheets: false, formulas: false, clipboard: true, images: true, shapes: false, textBoxes: true, comments: true } satisfies SpreadsheetFeatures;
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
