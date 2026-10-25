import type { SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetGridLayout } from "../api/table-commands";
import type { SpreadsheetLookupWriteReport } from "../api/lookup-commands";
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
  layout?: SpreadsheetGridLayout;
  lookup?: SpreadsheetLookupWriteReport;
  write?: SpreadsheetWriteReport;
}>;
