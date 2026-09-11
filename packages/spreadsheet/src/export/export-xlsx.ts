import { createZipArchive } from "../core";
import { normalizeWorkbook, calculateWorkbook } from "../model";
import { SPREADSHEET_LIMITS, type SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetExcelExportOptions } from "./types";
import type { XlsxContentType, XlsxPart, XlsxRelationship } from "./xlsx/types";
import { xml, xlsxText } from "./xlsx/xml";
import { createXlsxStyles } from "./xlsx/styles";
import { worksheetXml } from "./xlsx/worksheet";
import { commentParts } from "./xlsx/comments";
import { prepareWorksheetDrawings } from "./xlsx/drawings";
import { createXlsxMediaRegistry } from "./xlsx/images";
import { createValidationListRegistry } from "./xlsx/validation-lists";
import { worksheetTableParts } from "./xlsx/tables";
import { workbookDefinedNamesXml } from "./xlsx/named-ranges";

const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const part = (path: string, value: string): XlsxPart => ({ path, content: new Blob([value], { type: "application/xml" }) });

function relationshipsXml(links: XlsxRelationship[]): string {
  return `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map(link =>
    `<Relationship Id="${xml(link.id)}" Type="${xml(link.type)}" Target="${xml(link.target)}"/>`).join("")}</Relationships>`;
}

function contentTypesXml(types: XlsxContentType[]): string {
  const unique = new Map<string, XlsxContentType>();
  for (const type of types) {
    const key = type.extension ? `extension:${type.extension}` : `part:${type.partName}`;
    if (unique.has(key) && unique.get(key)!.contentType !== type.contentType) throw new Error("Excelパッケージの形式が一致しません");
    unique.set(key, type);
  }
  return `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...unique.values()].map(type =>
    type.extension ? `<Default Extension="${xml(type.extension)}" ContentType="${xml(type.contentType)}"/>`
      : `<Override PartName="${xml(type.partName!)}" ContentType="${xml(type.contentType)}"/>`).join("")}</Types>`;
}

/** Generate XLSX from an isolated current workbook. No persistence, downloads, or external requests. */
export async function exportSpreadsheetXlsx(input: SpreadsheetWorkbook, options: SpreadsheetExcelExportOptions = {}): Promise<Blob> {
  const { signal } = options;
  signal?.throwIfAborted();
  const workbook = normalizeWorkbook(input), calculated = calculateWorkbook(workbook);
  const styles = createXlsxStyles(workbook), media = createXlsxMediaRegistry();
  const validationLists = createValidationListRegistry(workbook);
  const parts: XlsxPart[] = [], workbookLinks: XlsxRelationship[] = [];
  const contentTypes: XlsxContentType[] = [
    { extension: "rels", contentType: "application/vnd.openxmlformats-package.relationships+xml" },
    { extension: "xml", contentType: "application/xml" },
    { partName: "/xl/workbook.xml", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" },
    { partName: "/xl/styles.xml", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" },
  ];
  let imageBytes = 0, nextTableNumber = 1;
  for (let index = 0; index < workbook.sheets.length; index++) {
    signal?.throwIfAborted();
    const sheet = workbook.sheets[index], number = index + 1;
    const tables = worksheetTableParts(sheet, nextTableNumber);
    nextTableNumber += tables.parts.length;
    const comments = commentParts(sheet, number);
    const drawing = await prepareWorksheetDrawings(sheet, workbook.resources, { sheetIndex: number, signal, media });
    signal?.throwIfAborted();
    for (const image of drawing.parts.filter(item => item.path.startsWith("xl/media/"))) imageBytes += image.content.size;
    if (imageBytes > SPREADSHEET_LIMITS.totalImageBytes) throw new Error("Excel出力用に変換した画像の合計が20 MiBを超えています");
    const links = [...comments.relationships, ...tables.relationships];
    const drawingId = drawing.drawingPath ? "rIdDrawing" : undefined;
    if (drawingId) links.push({ id: drawingId, type: `${relationship}drawing`, target: drawing.drawingRelationshipTarget! });
    parts.push(part(`xl/worksheets/sheet${number}.xml`, worksheetXml(workbook, sheet, styles, calculated,
      { drawingId, commentsDrawingId: comments.legacyDrawingId, formulaForList: validationLists.formulaForList,
        tableRelationshipIds: tables.relationshipIds })), ...comments.parts, ...drawing.parts, ...tables.parts);
    if (links.length) parts.push(part(`xl/worksheets/_rels/sheet${number}.xml.rels`, relationshipsXml(links)));
    workbookLinks.push({ id: `rId${number}`, type: `${relationship}worksheet`, target: `worksheets/sheet${number}.xml` });
    contentTypes.push({ partName: `/xl/worksheets/sheet${number}.xml`, contentType: sheetType }, ...comments.contentTypes, ...drawing.contentTypes, ...tables.contentTypes);
  }
  const helperNumber = workbook.sheets.length + 1;
  if (validationLists.hasLists) {
    parts.push(part(`xl/worksheets/sheet${helperNumber}.xml`, validationLists.worksheetXml()));
    workbookLinks.push({ id: `rId${helperNumber}`, type: `${relationship}worksheet`, target: `worksheets/sheet${helperNumber}.xml` });
    contentTypes.push({ partName: `/xl/worksheets/sheet${helperNumber}.xml`, contentType: sheetType });
  }
  const helperSheet = validationLists.hasLists ? `<sheet name="${xlsxText(validationLists.sheetName)}" sheetId="${helperNumber}" state="hidden" r:id="rId${helperNumber}"/>` : "";
  workbookLinks.push({ id: "rIdStyles", type: `${relationship}styles`, target: "styles.xml" });
  parts.push(part("xl/workbook.xml", `${header}<workbook xmlns="${main}" xmlns:r="${relationship.slice(0, -1)}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${workbook.sheets.map((sheet, index) =>
    `<sheet name="${xlsxText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}${helperSheet}</sheets>${workbookDefinedNamesXml(workbook, validationLists.definedNameElementsXml)}<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`),
  part("xl/styles.xml", styles.xml), part("xl/_rels/workbook.xml.rels", relationshipsXml(workbookLinks)),
  part("_rels/.rels", relationshipsXml([{ id: "rIdWorkbook", type: `${relationship}officeDocument`, target: "xl/workbook.xml" }])),
  part("[Content_Types].xml", contentTypesXml(contentTypes)));
  signal?.throwIfAborted();
  return createZipArchive(parts, { signal, type: XLSX_MIME_TYPE });
}
