import { getCellFormat } from "../../model/format-ranges";
import { cellAddress } from "../../model/address";
import { effectiveCellFormat } from "../../model/formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetCellFormat, SpreadsheetMergedRange, SpreadsheetSheet } from "../../model/types";

export type CellTextOverflow = Readonly<{ before: number; after: number }>;

/** Empty styled cells permit overflow. Stored content (including =""), merges,
 * live editors and checkboxes stop it. Two row sweeps keep wide sheets linear. */
export function rowTextOverflowLimits(sheet: SpreadsheetSheet, row: number, columnOffsets: readonly number[],
  merges: ReadonlyMap<number, SpreadsheetMergedRange>, checkboxes: boolean, editingColumn?: number,
  formatAt: (column: number) => SpreadsheetCellFormat | undefined = column => effectiveCellFormat(sheet.cells[cellAddress(row, column)], getCellFormat(sheet, row, column))) {
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
  // Center across selection and Fill end at a differently formatted or occupied
  // cell. A reverse sweep avoids rescanning a wide selected range for every cell.
  const alignmentRight = new Array<number>(sheet.columnCount);
  let nextAlignment: SpreadsheetCellFormat["align"], end = sheet.columnCount;
  for (let column = sheet.columnCount - 1; column >= 0; column--) {
    const align = formatAt(column)?.align;
    if (align !== nextAlignment) end = column + 1;
    alignmentRight[column] = columnOffsets[end];
    if (blocked[column]) end = column;
    nextAlignment = align;
  }
  return { left, right, alignmentRight };
}

export function cellTextOverflow(column: number, value: SpreadsheetCalculatedValue | undefined,
  format: SpreadsheetCellFormat | undefined, columnOffsets: readonly number[],
  limits: ReturnType<typeof rowTextOverflowLimits>, confined: boolean): CellTextOverflow {
  if (confined || value === undefined || value === "") return { before: 0, after: 0 };
  const align = format?.align ?? "general";
  if (align === "centerContinuous" || align === "fill")
    return { before: 0, after: Math.max(0, limits.alignmentRight[column] - columnOffsets[column + 1]) };
  if (typeof value !== "string" || format?.wrap || format?.shrinkToFit || align === "justify" || align === "distributed" ||
    format?.verticalAlign === "justify" || format?.verticalAlign === "distributed")
    return { before: 0, after: 0 };
  return {
    before: align === "left" || align === "general" ? 0 : columnOffsets[column] - limits.left[column],
    after: align === "right" ? 0 : limits.right[column] - columnOffsets[column + 1],
  };
}
