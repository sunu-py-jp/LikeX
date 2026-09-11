import { cellAddress } from "../../model/address";
import type { SpreadsheetTable } from "../../model/tables/types";
import type { SpreadsheetSheet } from "../../model/types";
import type { XlsxContentType, XlsxPart, XlsxRelationship } from "./types";
import { xml, xlsxText } from "./xml";

const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";

/** A table part stores its definition; cell values and formatting remain in the worksheet part. */
export function tableXml(table: SpreadsheetTable, number: number): string {
  const range = `${cellAddress(table.range.top, table.range.left)}:${cellAddress(table.range.bottom, table.range.right)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${main}" id="${number}" name="${xlsxText(table.name)}" displayName="${xlsxText(table.name)}" ref="${range}" headerRowCount="1" totalsRowShown="0"><autoFilter ref="${range}"/><tableColumns count="${table.columns.length}">${table.columns.map((column, index) =>
    `<tableColumn id="${index + 1}" name="${xlsxText(column.name)}"/>`).join("")}</tableColumns></table>`;
}

export function worksheetTableParts(sheet: SpreadsheetSheet, firstNumber: number): {
  parts: XlsxPart[]; relationships: XlsxRelationship[]; contentTypes: XlsxContentType[]; relationshipIds: string[];
} {
  const parts: XlsxPart[] = [], relationships: XlsxRelationship[] = [], contentTypes: XlsxContentType[] = [], relationshipIds: string[] = [];
  for (const [index, table] of (sheet.tables ?? []).entries()) {
    const number = firstNumber + index, path = `xl/tables/table${number}.xml`, id = `rIdTable${number}`;
    parts.push({ path, content: new Blob([tableXml(table, number)], { type: "application/xml" }) });
    relationships.push({ id, type: relationship, target: `../tables/table${number}.xml` });
    contentTypes.push({ partName: `/${path}`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" });
    relationshipIds.push(id);
  }
  return { parts, relationships, contentTypes, relationshipIds };
}

export function tablePartsXml(relationshipIds: readonly string[] = []): string {
  return relationshipIds.length ? `<tableParts count="${relationshipIds.length}">${relationshipIds.map(id => `<tablePart r:id="${xml(id)}"/>`).join("")}</tableParts>` : "";
}
