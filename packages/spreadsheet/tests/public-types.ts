import type {
  SpreadsheetCell,
  SpreadsheetCellFormat,
  SpreadsheetFeatures,
  SpreadsheetProps,
  SpreadsheetSaveHandler,
  SpreadsheetSelection,
  SpreadsheetWorkbook,
} from "../src";

const cell: SpreadsheetCell = { value: "=SUM(A1:A10)", format: { numberFormat: "currency", bold: true } };
const workbook: SpreadsheetWorkbook = { sheets: [{ id: "main", name: "Sheet1", rowCount: 100, columnCount: 26, cells: { B1: cell } }] };
const save: SpreadsheetSaveHandler = async (value) => value;
const features = { sheets: false, formulas: false, clipboard: true } satisfies SpreadsheetFeatures;
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
