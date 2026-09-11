import type { SpreadsheetSheet } from "../types";
import { canonicalCellAddress, validateCellValue } from "./validation";

export type SpreadsheetWriteConflictPolicy = "error" | "overwrite" | "skip";
export type SpreadsheetWriteOptions = Readonly<{ onConflict?: SpreadsheetWriteConflictPolicy }>;

export class WriteConflictError extends Error {
  readonly code = "WRITE_CONFLICT";
  readonly conflicts: readonly string[];
  constructor(addresses: readonly string[]) {
    super(`書き込み先の${addresses.length}セルに既存の値があります`);
    this.conflicts = Object.freeze([...addresses]);
  }
}

/** Resolve raw input values before changing values, formatting, or related metadata. */
export function filterCellValueWrites(sheet: SpreadsheetSheet, input: Readonly<Record<string, string>>,
  onConflict: SpreadsheetWriteConflictPolicy = "overwrite"): Readonly<{
    values: Readonly<Record<string, string>>; skippedAddresses: readonly string[];
  }> {
  if (!["error", "overwrite", "skip"].includes(onConflict)) throw new Error("既存値の扱いが正しくありません");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("セルの値はオブジェクトで指定してください");
  const values: Record<string, string> = Object.create(null), conflicts: string[] = [];
  for (const [address, raw] of Object.entries(input)) {
    const key = canonicalCellAddress(sheet, address), value = validateCellValue(raw);
    if (Object.hasOwn(values, key)) throw new Error("同じセルが重複して指定されています");
    values[key] = value;
    const previous = sheet.cells[key]?.value ?? "";
    if (previous !== "" && previous !== value) conflicts.push(key);
  }
  if (onConflict === "error" && conflicts.length) throw new WriteConflictError(conflicts);
  if (onConflict === "skip") for (const key of conflicts) delete values[key];
  return Object.freeze({ values: Object.freeze(values), skippedAddresses: Object.freeze(onConflict === "skip" ? conflicts : []) });
}
