import type { SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetCommand, SpreadsheetWriteReport } from "./types";

/** Internal receipt before the staging engine adds command-specific placement. */
export type SpreadsheetCommandBaseReceipt = Readonly<{
  type: SpreadsheetCommand["type"];
  sheetId: string;
  drawingId?: string;
  resourceId?: string;
  commentId?: string;
  namedRangeId?: string;
  tableId?: string;
  range?: SpreadsheetMergedRange;
  write?: SpreadsheetWriteReport;
}>;
