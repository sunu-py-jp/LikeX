import type { SpreadsheetCommand } from "./types";

/** Internal receipt before the staging engine adds command-specific placement. */
export type SpreadsheetCommandBaseReceipt = Readonly<{
  type: SpreadsheetCommand["type"];
  sheetId: string;
  drawingId?: string;
  resourceId?: string;
  commentId?: string;
}>;
