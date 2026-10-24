import { getFormattedCell, resolveFormatRange } from "../../model/format-ranges";
import type { OfficePackageSignal } from "../../ooxml";
import { cellTextValue, isFormulaCell } from "../../model/cell-value";
import { cellAddress, parseCellAddress } from "../../model/address";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../../model/sheet-dimensions";
import { excelDateSerial } from "../../model/formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";
import { EXCEL_ERRORS, xlsxFormula } from "./formula";
import { xlsxCellFormat, type XlsxStyles } from "./styles";
import { conditionalFormattingXml } from "./conditional-formatting";
import { dataValidationsXml } from "./data-validation";
import { xml, xlsxText } from "./xml";
import { tablePartsXml } from "./tables";
import { pixelsToXlsxColumnWidth as columnWidth } from "../../xlsx-column-width";
import { getSpreadsheetFilteredRows } from "../../model/filters";
import { autoFilterXml } from "./auto-filter";

type Calculated = Record<string, Record<string, SpreadsheetCalculatedValue>>;
type Links = { drawingId?: string; commentsDrawingId?: string; formulaForList?: (values: readonly string[]) => string;
  tableRelationshipIds?: readonly string[] };
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numericValue(value: string): number | undefined {
  if (!numeric.test(value) || /^[+-]?0\d/.test(value)) return;
  const mantissa = value.split(/[eE]/)[0].replace(/[+\-.]/g, "").replace(/^0+/, "");
  const number = Number(value);
  if (mantissa.length > 15 || !Number.isFinite(number) || Math.abs(number) > 9.99999999999999e307 || (number === 0 && /[1-9]/.test(mantissa)) ||
    (number !== 0 && Math.abs(number) < 2.2250738585072014e-308)) return;
  return number;
}
function checkText(value: string, label: string) {
  if (value.length > 32_767 || (value.match(/\n/g)?.length ?? 0) > 253)
    throw new Error(`Excelのセル文字数または改行数の上限を超えています（${label}）`);
}
function cellXml(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, address: string, cell: SpreadsheetCell, styles: XlsxStyles, calculated: Calculated, headerText?: string): string {
  const label = `${sheet.name}!${address}`, value = cell.value;
  checkText(value, label);
  const format = xlsxCellFormat(cell);
  const attributes = `r="${xml(address)}" s="${styles.styleId(format)}"`;
  if (headerText !== undefined) return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xlsxText(headerText)}</t></is></c>`;
  // Empty model values are blank cells, which Excel must not count as empty text.
  if (value === "") return `<c ${attributes}/>`;
  if (format?.numberFormat === "text") return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xlsxText(cellTextValue(value))}</t></is></c>`;
  if (isFormulaCell(cell)) {
    const formula = xlsxFormula(value, workbook, sheet), result = calculated[sheet.id]?.[address];
    let cache = "", type = "";
    if (typeof result === "number" && Number.isFinite(result)) cache = `<v>${xml(result)}</v>`;
    else if (typeof result === "boolean") { type = ' t="b"'; cache = `<v>${Number(result)}</v>`; }
    else if (typeof result === "string" && !["#CYCLE!", "#LIMIT!", "#ERROR!"].includes(result)) {
      checkText(result, label); type = EXCEL_ERRORS.has(result) ? ' t="e"' : ' t="str"'; cache = `<v>${xlsxText(result)}</v>`;
    }
    return `<c ${attributes}${type}><f>${xml(formula)}</f>${cache}</c>`;
  }
  if (value.startsWith("'")) return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xlsxText(value.slice(1))}</t></is></c>`;
  const kind = format?.numberFormat;
  if (kind === "date" || kind === "time" || kind === "datetime") {
    const serial = excelDateSerial(value, kind);
    if (serial !== undefined) return `<c ${attributes}><v>${xml(serial)}</v></c>`;
    if (cell.validation?.type === "date" && numericValue(value) === undefined) throw new Error(`Excelへ出力できる日付は1900年以降のISO日付またはExcelの日付シリアル値です（${label}）`);
  }
  const number = numericValue(value);
  if (number !== undefined) return `<c ${attributes}><v>${xml(number)}</v></c>`;
  if (/^(true|false)$/i.test(value)) return `<c ${attributes} t="b"><v>${value.toLowerCase() === "true" ? 1 : 0}</v></c>`;
  return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xlsxText(value)}</t></is></c>`;
}
/** Generate only one row of expanded finite formatting at a time. */
function* worksheetChunks(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, styles: XlsxStyles, calculated: Calculated, links: Links): Generator<string> {
  const filteredRows = getSpreadsheetFilteredRows(sheet, calculated[sheet.id]);
  const tableHeaders = new Map((sheet.tables ?? []).flatMap(table => table.columns.map((column, index) =>
    [cellAddress(table.range.top, table.range.left + index), column.name] as const)));
  const rows = new Map<number, Map<number, { address: string; cell: SpreadsheetCell }>>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address)!;
    if (!rows.has(position.row)) rows.set(position.row, new Map());
    rows.get(position.row)!.set(position.column, { address, cell: getFormattedCell(sheet, position.row, position.column) ?? cell });
  }
  const columnFormats = new Map<number, SpreadsheetCellFormat>(), rowFormats = new Map<number, SpreadsheetCellFormat>();
  const finite = [] as { top: number; bottom: number; left: number; right: number; format: SpreadsheetCellFormat }[];
  for (const item of sheet.formatRanges ?? []) {
    const range = resolveFormatRange(sheet, item.range);
    if (item.range.top === 0 && item.range.bottom === "end")
      for (let column = range.left; column <= range.right; column++) columnFormats.set(column, item.format);
    else if (item.range.left === 0 && item.range.right === "end")
      for (let row = range.top; row <= range.bottom; row++) rowFormats.set(row, item.format);
    else finite.push({ ...range, format: item.format });
  }
  finite.sort((a, b) => a.top - b.top);
  const columns: string[] = [];
  for (let column = 0; column < sheet.columnCount; column++) {
    const width = sheet.columnWidths?.[column], format = columnFormats.get(column);
    if (width === undefined && format === undefined) continue;
    columns.push(`<col min="${column + 1}" max="${column + 1}"${width === undefined ? "" : ` width="${xml(columnWidth(width))}" customWidth="1"`}${format === undefined ? "" : ` style="${styles.styleId(format)}"`}/>`);
  }
  yield `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheet.autoFilter?.columns?.length ? '<sheetPr filterMode="1"/>' : ""}<dimension ref="A1:${cellAddress(sheet.rowCount - 1, sheet.columnCount - 1)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultColWidth="${columnWidth(DEFAULT_COLUMN_WIDTH)}" defaultRowHeight="${DEFAULT_ROW_HEIGHT * 0.75}"/>${columns.length ? `<cols>${columns.join("")}</cols>` : ""}<sheetData>`;
  let cursor = 0;
  const active = new Set<(typeof finite)[number]>();
  for (let row = 0; row < sheet.rowCount; row++) {
    while (cursor < finite.length && finite[cursor].top === row) active.add(finite[cursor++]);
    for (const range of active) if (range.bottom < row) active.delete(range);
    const cells = new Map(rows.get(row) ?? []);
    for (const range of active) for (let column = range.left; column <= range.right; column++)
      if (!cells.has(column)) cells.set(column, { address: cellAddress(row, column), cell: { value: "", format: range.format } });
    const height = sheet.rowHeights?.[row], rowFormat = rowFormats.get(row);
    if (!cells.size && height === undefined && rowFormat === undefined && !filteredRows.has(row)) continue;
    if (height !== undefined && height * 0.75 > 409) throw new Error(`Excelの行の高さの上限を超えています（${sheet.name}!${row + 1}行）`);
    yield `<row r="${row + 1}"${filteredRows.has(row) ? ' hidden="1"' : ""}${height === undefined ? "" : ` ht="${xml(height * 0.75)}" customHeight="1"`}${rowFormat === undefined ? "" : ` s="${styles.styleId(rowFormat)}" customFormat="1"`}>${[...cells].sort(([left], [right]) => left - right).map(([, item]) => cellXml(workbook, sheet, item.address, item.cell, styles, calculated, tableHeaders.get(item.address))).join("")}</row>`;
  }
  const merges = (sheet.merges ?? []).map(range => `<mergeCell ref="${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}"/>`).join("");
  yield `</sheetData>${autoFilterXml(sheet.autoFilter)}${merges ? `<mergeCells count="${sheet.merges!.length}">${merges}</mergeCells>` : ""}${conditionalFormattingXml(sheet, styles)}${dataValidationsXml(sheet, { formulaForList: links.formulaForList })}${links.drawingId ? `<drawing r:id="${xml(links.drawingId)}"/>` : ""}${links.commentsDrawingId ? `<legacyDrawing r:id="${xml(links.commentsDrawingId)}"/>` : ""}${tablePartsXml(links.tableRelationshipIds)}</worksheet>`;
}
/** Synchronous helper for small in-memory consumers and tests. */
export function worksheetXml(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, styles: XlsxStyles, calculated: Calculated, links: Links = {}): string {
  return [...worksheetChunks(workbook, sheet, styles, calculated, links)].join("");
}
/** The file exporter keeps UTF-8 row blobs, not a second full expanded XML string. */
export async function worksheetBlob(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, styles: XlsxStyles, calculated: Calculated,
  links: Links = {}, signal?: OfficePackageSignal): Promise<Blob> {
  const parts: Blob[] = []; let count = 0;
  for (const chunk of worksheetChunks(workbook, sheet, styles, calculated, links)) {
    signal?.throwIfAborted(); parts.push(new Blob([chunk]));
    if (++count % 128 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
  }
  return new Blob(parts, { type: "application/xml" });
}
