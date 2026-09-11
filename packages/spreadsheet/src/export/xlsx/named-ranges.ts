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
  const names = userElements + helperElements;
  return names ? `<definedNames>${names}</definedNames>` : "";
}
