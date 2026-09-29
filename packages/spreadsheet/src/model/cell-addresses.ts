import { cellAddress } from "./address";
import { normalizeNamedRangeRectangle } from "./named-ranges";
import { SPREADSHEET_LIMITS, type SpreadsheetSheet } from "./types";

/** A malformed/out-of-bounds address or an expansion that exceeds the bounded range budget. */
export class CellAddressExpansionError extends Error {
  constructor(readonly index: number, readonly input: unknown, message: string) {
    super(`addresses[${index}]: ${message}`);
    this.name = "CellAddressExpansionError";
  }
}

/**
 * Expand same-sheet A1 cells/ranges in input order, then row-major order; canonicalize and deduplicate.
 * If any input is a range, the total unique cells must not exceed SPREADSHEET_LIMITS.rangeCells.
 * Explicit-only address arrays retain the existing unbounded selection contract.
 */
export function expandCellAddresses(sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">,
  inputs: readonly string[]): readonly string[] {
  if (!Array.isArray(inputs)) throw new Error("addressesはセル番地・範囲の配列で指定してください");
  const bounded = inputs.some(input => typeof input === "string" && input.includes(":"));
  const addresses = new Set<string>();
  for (let index = 0; index < inputs.length; index++) {
    const input: unknown = inputs[index];
    try {
      if (typeof input !== "string") throw new Error("セル番地・範囲は文字列で指定してください");
      const range = normalizeNamedRangeRectangle(input, sheet);
      if (bounded && (range.bottom - range.top + 1) * (range.right - range.left + 1) > SPREADSHEET_LIMITS.rangeCells)
        throw new Error(`範囲を含むaddressesは展開後の重複を除いて${SPREADSHEET_LIMITS.rangeCells.toLocaleString("en-US")}セルまで指定できます`);
      for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
        addresses.add(cellAddress(row, column));
        if (bounded && addresses.size > SPREADSHEET_LIMITS.rangeCells)
          throw new Error(`範囲を含むaddressesは展開後の重複を除いて${SPREADSHEET_LIMITS.rangeCells.toLocaleString("en-US")}セルまで指定できます`);
      }
    } catch (error) {
      throw new CellAddressExpansionError(index, input, error instanceof Error ? error.message : "セル番地・範囲が正しくありません");
    }
  }
  return Object.freeze([...addresses]);
}
