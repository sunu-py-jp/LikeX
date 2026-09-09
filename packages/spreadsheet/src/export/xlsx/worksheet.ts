import { cellAddress, parseCellAddress } from "../../model/address";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../../model/sheet-dimensions";
import type { SpreadsheetCalculatedValue, SpreadsheetCell, SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";
import { EXCEL_ERRORS, xlsxFormula } from "./formula";
import type { XlsxStyles } from "./styles";
import { xml, xlsxText } from "./xml";

type Calculated = Record<string, Record<string, SpreadsheetCalculatedValue>>;
type Links = { drawingId?: string; commentsDrawingId?: string };
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
function cellXml(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, address: string, cell: SpreadsheetCell, styles: XlsxStyles, calculated: Calculated): string {
  const label = `${sheet.name}!${address}`, value = cell.value;
  checkText(value, label);
  const attributes = `r="${xml(address)}" s="${styles.styleId(cell.format)}"`;
  if (value.startsWith("=")) {
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
  const number = numericValue(value);
  if (number !== undefined) return `<c ${attributes}><v>${xml(number)}</v></c>`;
  if (/^(true|false)$/i.test(value)) return `<c ${attributes} t="b"><v>${value.toLowerCase() === "true" ? 1 : 0}</v></c>`;
  return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xlsxText(value)}</t></is></c>`;
}
const columnWidth = (pixels: number) => Math.floor(((pixels - 5) / 7) * 256) / 256;

/** Worksheet schema ordering is centralized here; drawing relationships are supplied by the package assembler. */
export function worksheetXml(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, styles: XlsxStyles, calculated: Calculated, links: Links = {}): string {
  const rows = new Map<number, { address: string; column: number; cell: SpreadsheetCell }[]>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address)!;
    if (!rows.has(position.row)) rows.set(position.row, []);
    rows.get(position.row)!.push({ address, column: position.column, cell });
  }
  for (const key of Object.keys(sheet.rowHeights ?? {})) if (!rows.has(Number(key))) rows.set(Number(key), []);
  const rowXml = [...rows].sort(([left], [right]) => left - right).map(([row, cells]) => {
    const height = sheet.rowHeights?.[row];
    if (height !== undefined && height * 0.75 > 409) throw new Error(`Excelの行の高さの上限を超えています（${sheet.name}!${row + 1}行）`);
    return `<row r="${row + 1}"${height === undefined ? "" : ` ht="${xml(height * 0.75)}" customHeight="1"`}>${cells.sort((left, right) => left.column - right.column).map(item => cellXml(workbook, sheet, item.address, item.cell, styles, calculated)).join("")}</row>`;
  }).join("");
  const columns = Object.entries(sheet.columnWidths ?? {}).sort(([left], [right]) => Number(left) - Number(right)).map(([column, width]) =>
    `<col min="${Number(column) + 1}" max="${Number(column) + 1}" width="${xml(columnWidth(width))}" customWidth="1"/>`).join("");
  const merges = (sheet.merges ?? []).map(range => `<mergeCell ref="${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${cellAddress(sheet.rowCount - 1, sheet.columnCount - 1)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultColWidth="${columnWidth(DEFAULT_COLUMN_WIDTH)}" defaultRowHeight="${DEFAULT_ROW_HEIGHT * 0.75}"/>${columns ? `<cols>${columns}</cols>` : ""}<sheetData>${rowXml}</sheetData>${merges ? `<mergeCells count="${sheet.merges!.length}">${merges}</mergeCells>` : ""}${links.drawingId ? `<drawing r:id="${xml(links.drawingId)}"/>` : ""}${links.commentsDrawingId ? `<legacyDrawing r:id="${xml(links.commentsDrawingId)}"/>` : ""}</worksheet>`;
}
