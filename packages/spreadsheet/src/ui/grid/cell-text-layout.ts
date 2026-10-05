import { cellAddress } from "../../model/address";
import type { SpreadsheetCalculatedValue, SpreadsheetCellFormat, SpreadsheetMergedRange, SpreadsheetSheet } from "../../model/types";

export type CellTextOverflow = Readonly<{ before: number; after: number }>;

/** Empty styled cells permit overflow. Stored content (including =""), merges,
 * live editors and checkboxes stop it. Two row sweeps keep wide sheets linear. */
export function rowTextOverflowLimits(sheet: SpreadsheetSheet, row: number, columnOffsets: readonly number[],
  merges: ReadonlyMap<number, SpreadsheetMergedRange>, checkboxes: boolean, editingColumn?: number) {
  const blocked = Array.from({ length: sheet.columnCount }, (_, column) => {
    const cell = sheet.cells[cellAddress(row, column)];
    return !!cell?.value || merges.has(row * sheet.columnCount + column) || column === editingColumn ||
      !!(checkboxes && cell?.validation?.type === "checkbox");
  });
  const left = new Array<number>(sheet.columnCount), right = new Array<number>(sheet.columnCount);
  let boundary = 0;
  for (let column = 0; column < sheet.columnCount; column++) {
    left[column] = columnOffsets[boundary];
    if (blocked[column]) boundary = column + 1;
  }
  boundary = sheet.columnCount;
  for (let column = sheet.columnCount - 1; column >= 0; column--) {
    right[column] = columnOffsets[boundary];
    if (blocked[column]) boundary = column;
  }
  return { left, right };
}

export function cellTextOverflow(column: number, value: SpreadsheetCalculatedValue | undefined,
  format: SpreadsheetCellFormat | undefined, columnOffsets: readonly number[],
  limits: ReturnType<typeof rowTextOverflowLimits>, confined: boolean): CellTextOverflow {
  if (confined || typeof value !== "string" || !value || format?.wrap || format?.shrinkToFit)
    return { before: 0, after: 0 };
  const align = format?.align ?? "left";
  return {
    before: align === "left" ? 0 : columnOffsets[column] - limits.left[column],
    after: align === "right" ? 0 : limits.right[column] - columnOffsets[column + 1],
  };
}
