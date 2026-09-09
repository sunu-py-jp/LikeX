import type { SpreadsheetCellFormat, SpreadsheetWorkbook } from "../../model/types";
import { xml, xlsxColor } from "./xml";

export type XlsxStyles = { xml: string; styleId(format?: SpreadsheetCellFormat): number };
const formatCodes = { general: 0, number: 164, currency: 165, percent: 166 };
function opaque(value: string | undefined, fallback: string): string {
  const color = xlsxColor(value, fallback);
  return color.rgb.match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * color.alpha + 255 * (1 - color.alpha)).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function description(format?: SpreadsheetCellFormat) {
  return { bold: !!format?.bold, italic: !!format?.italic, underline: !!format?.underline,
    color: opaque(format?.color, "222222"), background: opaque(format?.background, "FFFFFF"),
    align: format?.align ?? "general", numberFormat: formatCodes[format?.numberFormat ?? "general"] };
}

/** Deduplicate the workbook's small cell-format model into SpreadsheetML style records. */
export function createXlsxStyles(workbook: SpreadsheetWorkbook): XlsxStyles {
  const ids = new Map<string, number>(), styles: ReturnType<typeof description>[] = [];
  const add = (format?: SpreadsheetCellFormat) => {
    const style = description(format), key = JSON.stringify(style);
    if (!ids.has(key)) { ids.set(key, styles.length); styles.push(style); }
  };
  add();
  for (const sheet of workbook.sheets) for (const cell of Object.values(sheet.cells)) add(cell.format);
  if (styles.length > 65_490) throw new Error("Excelのセル書式の上限を超えています");
  const fonts: string[] = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fontIds = new Map<string, number>(), fillIds = new Map<string, number>();
  const xfs = styles.map(style => {
    const font = `<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}${style.underline ? "<u/>" : ""}<sz val="11"/><color rgb="FF${style.color}"/><name val="Calibri"/><family val="2"/></font>`;
    if (!fontIds.has(font)) { fontIds.set(font, fonts.length); fonts.push(font); }
    let fillId = 0;
    if (style.background !== "FFFFFF") {
      if (!fillIds.has(style.background)) {
        fillIds.set(style.background, fills.length);
        fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${style.background}"/><bgColor indexed="64"/></patternFill></fill>`);
      }
      fillId = fillIds.get(style.background)!;
    }
    return `<xf numFmtId="${style.numberFormat}" fontId="${fontIds.get(font)}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1" applyNumberFormat="1"><alignment vertical="center"${style.align === "general" ? "" : ` horizontal="${xml(style.align)}"`}/></xf>`;
  });
  if (fonts.length > 512 || fills.length > 256) throw new Error("Excelのフォントまたは塗りつぶし書式の上限を超えています");
  const contents = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.##"/><numFmt numFmtId="165" formatCode="&quot;¥&quot;#,##0"/><numFmt numFmtId="166" formatCode="0.##%"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>`;
  return { xml: contents, styleId(format) {
    const id = ids.get(JSON.stringify(description(format)));
    if (id === undefined) throw new Error("Excelのセル書式が登録されていません");
    return id;
  } };
}
