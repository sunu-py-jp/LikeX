import { effectiveCellFormat, cellNumberFormatCode } from "../../model/formatting";
import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetWorkbook } from "../../model/types";
import type { SpreadsheetCellBorder } from "../../model/formatting";
import { xml, xlsxColor } from "./xml";

export type XlsxStyles = { xml: string; styleId(format?: SpreadsheetCellFormat): number; dxfId(format: SpreadsheetCellFormat): number };
export function xlsxCellFormat(cell: SpreadsheetCell): SpreadsheetCellFormat | undefined {
  return effectiveCellFormat(cell);
}
export function opaqueXlsxColor(value: string | undefined, fallback = "222222"): string {
  const color = xlsxColor(value, fallback);
  return color.rgb.match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * color.alpha + 255 * (1 - color.alpha)).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function borderEdge(edge: string, border?: SpreadsheetCellBorder): string {
  if (!border || border.style === "none") return `<${edge}/>`;
  const width = border.width ?? 1;
  const style = border.style === "double" ? "double" : border.style === "dotted" ? "dotted" : border.style === "dashed" ? width > 1 ? "mediumDashed" : "dashed" : width === 3 ? "thick" : width === 2 ? "medium" : "thin";
  return `<${edge} style="${style}"><color rgb="FF${opaqueXlsxColor(border.color, "808080")}"/></${edge}>`;
}
function borderXml(format?: SpreadsheetCellFormat) { return `<border>${["left", "right", "top", "bottom"].map(edge => borderEdge(edge, format?.borders?.[edge as "left"])).join("")}<diagonal/></border>`; }
function fontXml(format?: SpreadsheetCellFormat, differential = false) {
  return `<font>${format?.bold ? "<b/>" : differential && format?.bold === false ? '<b val="0"/>' : ""}${format?.italic ? "<i/>" : differential && format?.italic === false ? '<i val="0"/>' : ""}${format?.underline ? "<u/>" : differential && format?.underline === false ? '<u val="none"/>' : ""}${!differential || format?.fontSize !== undefined ? `<sz val="${format?.fontSize === undefined ? 11 : format.fontSize * 0.75}"/>` : ""}${!differential || format?.color !== undefined ? `<color rgb="FF${opaqueXlsxColor(format?.color)}"/>` : ""}${!differential || format?.fontFamily ? `<name val="${xml(format?.fontFamily ?? "Calibri")}"/>` : ""}</font>`;
}
function fillXml(color: string) { return `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`; }
function alignmentXml(format?: SpreadsheetCellFormat, differential = false) {
  return `<alignment${!differential || format?.verticalAlign ? ` vertical="${format?.verticalAlign === "middle" || !format?.verticalAlign ? "center" : format.verticalAlign}"` : ""}${format?.align ? ` horizontal="${format.align}"` : ""}${!differential || format?.wrap !== undefined ? ` wrapText="${format?.wrap ? 1 : 0}"` : ""}/>`;
}
/** Deduplicate fonts, fills, edges, number formats and conditional differential formats. */
export function createXlsxStyles(workbook: SpreadsheetWorkbook): XlsxStyles {
  const numberCodes: string[] = ["number", "currency", "percent"].map(kind => cellNumberFormatCode({ numberFormat: kind as "number" })!);
  const numberId = (format?: SpreadsheetCellFormat) => { const code = cellNumberFormatCode(format); if (!code) return 0; let index = numberCodes.indexOf(code); if (index < 0) { index = numberCodes.length; numberCodes.push(code); } return 164 + index; };
  const description = (format?: SpreadsheetCellFormat) => ({ font: fontXml(format), background: opaqueXlsxColor(format?.background, "FFFFFF"), alignment: alignmentXml(format), border: borderXml(format), number: numberId(format) });
  const ids = new Map<string, number>(), styles: ReturnType<typeof description>[] = [];
  const add = (format?: SpreadsheetCellFormat) => { const style = description(format), key = JSON.stringify(style); if (!ids.has(key)) { ids.set(key, styles.length); styles.push(style); } };
  const dxfs: string[] = [], dxfIds = new Map<string, number>();
  const dxfXml = (format: SpreadsheetCellFormat) => `<dxf>${["bold", "italic", "underline", "color", "fontFamily", "fontSize"].some(key => format[key as keyof SpreadsheetCellFormat] !== undefined) ? fontXml(format, true) : ""}${format.numberFormat ? `<numFmt numFmtId="${numberId(format)}" formatCode="${xml(cellNumberFormatCode(format) ?? "General")}"/>` : ""}${format.background ? fillXml(opaqueXlsxColor(format.background, "FFFFFF")) : ""}${format.align || format.verticalAlign || format.wrap !== undefined ? alignmentXml(format, true) : ""}${format.borders ? borderXml(format) : ""}</dxf>`;
  add();
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) add(xlsxCellFormat(cell));
    for (const rule of sheet.conditionalFormats ?? []) if (rule.type === "comparison" || rule.type === "text") { const contents = dxfXml(rule.format); if (!dxfIds.has(contents)) { dxfIds.set(contents, dxfs.length); dxfs.push(contents); } }
  }
  if (styles.length > 65_490) throw new Error("Excelのセル書式の上限を超えています");
  const fonts: string[] = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders: string[] = [];
  const fontIds = new Map<string, number>(), fillIds = new Map<string, number>(), borderIds = new Map<string, number>();
  const register = (value: string, values: string[], map: Map<string, number>) => { if (!map.has(value)) { map.set(value, values.length); values.push(value); } return map.get(value)!; };
  const xfs = styles.map(style => {
    const font = register(style.font, fonts, fontIds), border = register(style.border, borders, borderIds);
    const fill = style.background === "FFFFFF" ? 0 : register(fillXml(style.background), fills, fillIds);
    return `<xf numFmtId="${style.number}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">${style.alignment}</xf>`;
  });
  if (fonts.length > 512 || fills.length > 256) throw new Error("Excelのフォントまたは塗りつぶし書式の上限を超えています");
  const contents = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${numberCodes.length}">${numberCodes.map((code, index) => `<numFmt numFmtId="${164 + index}" formatCode="${xml(code)}"/>`).join("")}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs></styleSheet>`;
  return { xml: contents, styleId(format) { const id = ids.get(JSON.stringify(description(format))); if (id === undefined) throw new Error("Excelのセル書式が登録されていません"); return id; }, dxfId(format) { const id = dxfIds.get(dxfXml(format)); if (id === undefined) throw new Error("Excelの条件付き書式が登録されていません"); return id; } };
}
