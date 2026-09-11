import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetWriteReport } from "./types";

/** Counts actual value changes, independently of formatting and metadata changes. */
export function cellWriteReport(before: SpreadsheetWorkbook, after: SpreadsheetWorkbook,
  skippedAddresses: readonly string[] = []): SpreadsheetWriteReport {
  let changedCount = 0;
  const previousSheets = new Map(before.sheets.map(sheet => [sheet.id, sheet]));
  for (const sheet of after.sheets) {
    const oldCells = previousSheets.get(sheet.id)?.cells ?? {};
    const cells = sheet.cells;
    if (oldCells === cells) continue;
    const addresses = new Set([...Object.keys(oldCells), ...Object.keys(cells)]);
    for (const address of addresses) if ((oldCells[address]?.value ?? "") !== (cells[address]?.value ?? "")) changedCount++;
  }
  return Object.freeze({ changedCount, skippedCount: skippedAddresses.length, skippedAddresses: Object.freeze([...skippedAddresses]) });
}
