import type { SpreadsheetWriteConflictPolicy } from "../model/workbook/write-conflicts";
import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetCellPosition, SpreadsheetComment, SpreadsheetMergedRange, SpreadsheetMoveSource } from "../model/types";

export type SpreadsheetSearchQuery = Readonly<{ text: string; matchCase?: boolean; wholeCell?: boolean; lookIn?: "values" | "formulas" }>;
export type SpreadsheetSearchMatch = Readonly<{ sheetId: string; address: string; value: string; matchedText: string }>;
export type SpreadsheetPasteMode = "all" | "values" | "formulas" | "formats";
/** Preserve merges that extend beyond a copied/pasted rectangle. Defaults to rejecting partial merges. */
export type SpreadsheetPartialMergePolicy = "reject" | "skip";
export type SpreadsheetPastePayload = Readonly<{
  values: readonly (readonly string[])[];
  displayedValues?: readonly (readonly string[])[];
  /** Distinguishes literal strings such as 00123 or =text from calculated numbers/booleans. */
  valueTypes?: readonly (readonly ("string" | "number" | "boolean")[])[];
  formats?: readonly (readonly (SpreadsheetCellFormat | null | undefined)[])[];
  validations?: readonly (readonly (SpreadsheetCell["validation"] | null | undefined)[])[];
  /** Copied comments receive fresh IDs on paste. Null clears a destination comment. */
  comments?: readonly (readonly (Readonly<Omit<SpreadsheetComment, "id">> | null)[])[];
  /** Complete merged ranges relative to the copied rectangle's top-left. [] also permits replacing destination merges. */
  merges?: readonly SpreadsheetMergedRange[];
  source?: Readonly<SpreadsheetCellPosition & { sheetId: string }>;
}>;
export type SpreadsheetEditingCommand =
  | Readonly<{ type: "cells.replace"; sheetId: string; query: SpreadsheetSearchQuery; replacement: string; addresses?: readonly string[]; onConflict?: SpreadsheetWriteConflictPolicy }>
  | Readonly<{ type: "cells.fill"; sheetId: string; source: SpreadsheetMergedRange; target: SpreadsheetMergedRange; mode?: "auto" | "copy" | "series"; onConflict?: SpreadsheetWriteConflictPolicy }>
  | Readonly<{ type: "cells.paste"; sheetId: string; target: Readonly<SpreadsheetCellPosition>; payload: SpreadsheetPastePayload; mode?: SpreadsheetPasteMode; onConflict?: SpreadsheetWriteConflictPolicy; partialMerges?: SpreadsheetPartialMergePolicy }>
  /** Cut/paste preserves cell identity and updates references, including across sheets. */
  | Readonly<{ type: "cells.move"; sheetId: string; source: Readonly<SpreadsheetMoveSource>; target: Readonly<SpreadsheetCellPosition>; onConflict?: SpreadsheetWriteConflictPolicy }>
  | Readonly<{ type: "sheets.duplicate"; sheetId: string; name?: string }>;
