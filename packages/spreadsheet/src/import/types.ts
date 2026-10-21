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
/** The workbook's Normal style, with its point size converted to CSS pixels (96 dpi). */
export type SpreadsheetExcelColumnWidthFont = Readonly<{
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}>;
/** Measure all digits 0–9 in the target environment; return the widest advance in device pixels. */
export type SpreadsheetExcelColumnWidthMetrics = Readonly<{
  maximumDigitWidth: number;
  /** Device pixels per CSS pixel; supported range: 0.25–8. */
  pixelRatio: number;
}>;
export type SpreadsheetExcelColumnWidthMeasurer = (font: SpreadsheetExcelColumnWidthFont) =>
  SpreadsheetExcelColumnWidthMetrics | undefined | Promise<SpreadsheetExcelColumnWidthMetrics | undefined>;
export type SpreadsheetExcelImportOptions = {
  signal?: SpreadsheetExcelImportSignal;
  /** Preserve blank-cell formatting by default; omit explicitly for data-oriented imports. */
  emptyCellFormatting?: "preserve" | "omit";
  /** Called once per workbook. Undefined metrics use the deterministic Calibri 11pt/96dpi fallback. */
  columnWidthMeasurement?: SpreadsheetExcelColumnWidthMeasurer;
};
/** Native imports share the snapshot contract; their warnings array is always empty. */
export type SpreadsheetNativeImportResult = SpreadsheetExcelImportResult;
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
  themeFonts?: Readonly<Record<string, string>>;
  columnWidthFont?: SpreadsheetExcelColumnWidthFont;
  columnWidthMetrics?: SpreadsheetExcelColumnWidthMetrics;
  date1904?: boolean;
  resolveListValues?: (reference: string, sheetName: string) => readonly string[] | undefined;
  cellTextCharacters?: number;
  /** Nonempty source values admitted by the streaming reader; resolved formulas are checked after conversion. */
  sourceDataCells?: number;
  /** Retained optional features across the workbook; omitted items do not consume model capacity. */
  mergeCount?: number;
  drawingCount?: number;
  commentCount?: number;
  tableCount?: number;
  tableNames?: Set<string>;
  remainingExtraCells?: number;
  sheetNames?: ReadonlyMap<string, string>;
  warn(warning: SpreadsheetExcelImportWarning): void;
};

/** Fixed, conservative limits apply before allocation and to actual inflated output. */
export const XLSX_IMPORT_LIMITS = Object.freeze({
  inputBytes: 32 * 1024 * 1024, entries: 4096,
  entryBytes: 100 * 1024 * 1024, totalBytes: 100 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024, xmlDepth: 64, xmlNodes: 600_000,
  xmlText: 16 * 1024 * 1024,
  worksheetXmlBytes: 100 * 1024 * 1024, worksheetXmlNodes: 8_000_000,
  worksheetXmlText: 100 * 1024 * 1024,
  cellTextCharacters: 32 * 1024 * 1024,
});
