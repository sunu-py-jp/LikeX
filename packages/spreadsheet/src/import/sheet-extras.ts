import type { SpreadsheetSheet } from "../model/types";
import { readWorksheetDrawings } from "./drawings";
import { readWorksheetComments, readWorksheetTables } from "./extras-tables-comments";
import { readWorksheetValidations } from "./extras-validations";
import { worksheetDefaultSizes } from "./worksheet-shared";
import type { XlsxRelationship } from "./relationships";
import type { ImportContext } from "./types";
import type { XmlNode } from "./xml";

/** Read bounded optional worksheet features after cell data and workbook references are available. */
export async function readWorksheetExtras(node: XmlNode, initial: SpreadsheetSheet, _part: string,
  relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  context.signal?.throwIfAborted();
  let sheet = readWorksheetValidations(node, initial, context);
  sheet = await readWorksheetComments(sheet, relationships, context);
  sheet = await readWorksheetTables(node, sheet, relationships, context);
  sheet = await readWorksheetDrawings(node, sheet, relationships, context);
  // Extras can extend a small sheet. Continue its Excel defaults beyond the original canvas.
  const defaults = worksheetDefaultSizes(node), rowHeights = { ...sheet.rowHeights }, columnWidths = { ...sheet.columnWidths };
  for (let row = initial.rowCount; row < sheet.rowCount; row++) rowHeights[row] ??= defaults.row;
  for (let column = initial.columnCount; column < sheet.columnCount; column++) columnWidths[column] ??= defaults.column;
  context.signal?.throwIfAborted();
  return { ...sheet, ...(Object.keys(rowHeights).length ? { rowHeights } : {}), ...(Object.keys(columnWidths).length ? { columnWidths } : {}) };
}
