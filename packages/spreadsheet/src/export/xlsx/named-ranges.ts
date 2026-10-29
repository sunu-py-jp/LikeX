import { cellAddress } from "../../model/address";
import type { SpreadsheetWorkbook } from "../../model/types";
import { xml, xlsxText } from "./xml";

/** User names and hidden validation-list names share one definedNames element. */
export function workbookDefinedNamesXml(workbook: SpreadsheetWorkbook, helperElements = ""): string {
  const absolute = (row: number, column: number) => cellAddress(row, column).replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
  const userElements = (workbook.namedRanges ?? []).map(item => {
    const sheet = workbook.sheets.find(sheet => sheet.id === item.sheetId);
    if (!sheet) throw new Error("名前付き範囲のシートが見つかりません");
    const range = item.range, first = absolute(range.top, range.left), last = absolute(range.bottom, range.right);
    const formula = `'${sheet.name.replaceAll("'", "''")}'!${first}${first === last ? "" : `:${last}`}`;
    return `<definedName name="${xlsxText(item.name)}">${xml(formula)}</definedName>`;
  }).join("");
  const filterElements = workbook.sheets.map((sheet, index) => {
    const range = sheet.autoFilter?.range;
    if (!range) return "";
    const formula = `'${sheet.name.replaceAll("'", "''")}'!${absolute(range.top, range.left)}:${absolute(range.bottom, range.right)}`;
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xml(formula)}</definedName>`;
  }).join("");
  const printElements = workbook.sheets.map((sheet, index) => {
    const range = sheet.printSettings?.area;
    if (!range) return "";
    const formula = `'${sheet.name.replaceAll("'", "''")}'!${absolute(range.top, range.left)}:${absolute(range.bottom, range.right)}`;
    return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${xml(formula)}</definedName>`;
  }).join("");
  const names = userElements + helperElements + filterElements + printElements;
  return names ? `<definedNames>${names}</definedNames>` : "";
}
