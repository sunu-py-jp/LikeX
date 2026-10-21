import { normalizeFormatRanges } from "../format-ranges";
import type { SpreadsheetSheet } from "../types";

/** Prepare one immutable range index for a batch even when its host supplied mutable JSON. */
export function withFormatRangeContext<T extends Pick<SpreadsheetSheet, "rowCount" | "columnCount" | "formatRanges">>(sheet: T): T {
  if (!sheet.formatRanges?.length) return sheet;
  const formatRanges = normalizeFormatRanges(sheet.formatRanges, sheet);
  return formatRanges === sheet.formatRanges ? sheet : { ...sheet, formatRanges };
}
