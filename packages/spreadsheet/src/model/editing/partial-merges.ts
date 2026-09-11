import { cellAddress } from "../address";
import type { SpreadsheetMergedRange } from "../types";
import type { SpreadsheetPartialMergePolicy } from "../../api/editing-commands";

export function skipsPartialMerges(policy: SpreadsheetPartialMergePolicy | undefined): boolean {
  if (policy !== undefined && policy !== "reject" && policy !== "skip") throw new Error("部分的な結合セルの扱いは reject または skip で指定してください");
  return policy === "skip";
}

/** Callers bound the rectangle to the clipboard cell limit before enumerating it. */
export function mergedCellAddresses(range: SpreadsheetMergedRange, merges: readonly SpreadsheetMergedRange[]): Set<string> {
  const result = new Set<string>();
  for (const merge of merges) for (let row = Math.max(range.top, merge.top); row <= Math.min(range.bottom, merge.bottom); row++) {
    for (let column = Math.max(range.left, merge.left); column <= Math.min(range.right, merge.right); column++) result.add(cellAddress(row, column));
  }
  return result;
}
