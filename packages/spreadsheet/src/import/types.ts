import type { SpreadsheetImageResource, SpreadsheetWorkbook } from "../model/types";
import type { XlsxArchive } from "./zip";

export type SpreadsheetExcelImportWarning = Readonly<{
  code: "unsupported" | "adjusted" | "omitted";
  message: string;
  sheetName?: string;
  count?: number;
}>;
/** Structural browser-compatible contracts keep the model entry usable with ES2022-only typings. */
export type SpreadsheetExcelImportInput = ArrayBuffer | Uint8Array | {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};
export type SpreadsheetExcelImportSignal = {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};
export type SpreadsheetExcelImportOptions = { signal?: SpreadsheetExcelImportSignal };
export type SpreadsheetExcelImportResult = Readonly<{
  workbook: SpreadsheetWorkbook;
  warnings: readonly SpreadsheetExcelImportWarning[];
}>;
export type ImportContext = {
  archive: XlsxArchive;
  warnings: SpreadsheetExcelImportWarning[];
  signal?: SpreadsheetExcelImportSignal;
  resources: Record<string, SpreadsheetImageResource>;
  themeColors?: readonly string[];
  date1904?: boolean;
  resolveListValues?: (reference: string, sheetName: string) => readonly string[] | undefined;
  cellTextCharacters?: number;
  sheetNames?: ReadonlyMap<string, string>;
  warn(warning: SpreadsheetExcelImportWarning): void;
};

/** Fixed, conservative limits apply before allocation and to actual inflated output. */
export const XLSX_IMPORT_LIMITS = Object.freeze({
  inputBytes: 32 * 1024 * 1024, entries: 4096,
  entryBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024, xmlDepth: 64, xmlNodes: 600_000,
  xmlText: 16 * 1024 * 1024, sharedStrings: 100_000,
  cellTextCharacters: 32 * 1024 * 1024,
});
