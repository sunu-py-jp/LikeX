import { createWorkbook, createSpreadsheetSession, findSpreadsheetSheets, findSpreadsheetCells, getSheetReader, getSheetCells, type SpreadsheetStoredCell,
  type SpreadsheetSheetSearchQuery, type SpreadsheetSheetSearchMatch, type SpreadsheetSearchOptions, type SpreadsheetSearchMatch } from "../src/model-entry";
import { findSpreadsheetSheets as findSheetsFromRoot, getSheetCells as getSheetCellsFromRoot, type SpreadsheetStoredCell as RootStoredCell, type SpreadsheetHandle } from "../src/index";

const workbook = createWorkbook();
const storedCells: readonly SpreadsheetStoredCell[] = getSheetCells(workbook, workbook.sheets[0].id);
const rootCells: readonly RootStoredCell[] = getSheetCellsFromRoot(workbook, workbook.sheets[0].id);
void rootCells;
const query: SpreadsheetSheetSearchQuery = { text: "sales", matchCase: false, wholeName: false };
const sheets: readonly SpreadsheetSheetSearchMatch[] = findSpreadsheetSheets(workbook, query);
const options: SpreadsheetSearchOptions = { sheetId: workbook.sheets[0].id, range: "A1:C5" };
const cells: readonly SpreadsheetSearchMatch[] = findSpreadsheetCells(workbook, { text: "sales", lookIn: "formulas" }, options);
const session = createSpreadsheetSession(workbook);
session.findSheets(query);
session.getSheetCells(workbook.sheets[0].id);
session.sheet(workbook.sheets[0].id).getCells();
getSheetReader(workbook, workbook.sheets[0].id).getCells();
session.findCells({ text: "value" }, { ...options, range: { top: 0, left: 0, bottom: 4, right: 2 } });
getSheetReader(workbook, workbook.sheets[0].id).findCells({ text: "value" }, { range: "A1" });
session.sheet(workbook.sheets[0].id).findCells({ text: "value" });
declare const handle: SpreadsheetHandle;
handle.findSheets(query);
handle.getSheetCells(workbook.sheets[0].id);
handle.sheet(workbook.sheets[0].id).getCells();
handle.findCells({ text: "value" }, options);
handle.sheet(workbook.sheets[0].id).findCells({ text: "value" }, { range: "A1" });
findSheetsFromRoot(workbook, query);
// @ts-expect-error stored cell addresses are readonly
storedCells[0].address = "B2";
// @ts-expect-error stored cell formatting is deeply readonly
storedCells[0].format!.bold = true;
// @ts-expect-error sheet matches are immutable snapshots
sheets[0].name = "changed";
// @ts-expect-error result arrays are readonly
sheets.push({ sheetId: "x", name: "x", index: 0, rowCount: 1, columnCount: 1 });
// @ts-expect-error cell matches are immutable snapshots
cells[0].matchedText = "changed";
// @ts-expect-error literal matching options require booleans
findSpreadsheetSheets(workbook, { text: "sales", wholeName: "yes" });
// @ts-expect-error sheet-scoped readers already bind their sheet ID
session.sheet(workbook.sheets[0].id).findCells({ text: "value" }, { sheetId: "other" });
