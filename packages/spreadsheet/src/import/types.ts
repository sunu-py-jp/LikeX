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
export type SpreadsheetExcelImportLimits = Readonly<{
  /** Maximum compressed input size. Default: 128 MiB. */
  inputBytes?: number;
  /** Maximum expanded ZIP total and worksheet size. Default: resolved inputBytes × 5. */
  expandedBytes?: number;
}>;
export type SpreadsheetExcelImportOptions = {
  limits?: SpreadsheetExcelImportLimits;
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
  limits?: ResolvedXlsxImportLimits;
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
  formatRangeCount?: number;
  mergeCount?: number;
  drawingCount?: number;
  commentCount?: number;
  tableCount?: number;
  tableNames?: Set<string>;
  remainingExtraCells?: number;
  sheetNames?: ReadonlyMap<string, string>;
  /** Hidden source rows are compared with retained filter criteria after workbook calculation. */
  sourceHiddenRows?: Map<string, Set<number>>;
  warn(warning: SpreadsheetExcelImportWarning): void;
};

/** Structural budgets stay bounded independently of configurable archive capacity. */
export const XLSX_IMPORT_LIMITS = Object.freeze({
  inputBytes: 128 * 1024 * 1024, entries: 4096,
  entryBytes: 640 * 1024 * 1024, totalBytes: 640 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024, xmlDepth: 64, xmlNodes: 600_000,
  xmlText: 16 * 1024 * 1024,
  worksheetXmlBytes: 640 * 1024 * 1024, worksheetXmlNodes: 160_000_000,
  worksheetXmlText: 640 * 1024 * 1024,
  cellTextCharacters: 32 * 1024 * 1024,
});

export type ResolvedXlsxImportLimits = { [K in keyof typeof XLSX_IMPORT_LIMITS]: number };
export function resolveXlsxImportLimits(input?: SpreadsheetExcelImportLimits): ResolvedXlsxImportLimits {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input)))
    throw new Error("Excel取り込みの limits はオブジェクトで指定してください");
  if (input && Object.keys(input).some(key => key !== "inputBytes" && key !== "expandedBytes"))
    throw new Error("Excel取り込みの limits には inputBytes と expandedBytes を指定してください");
  const inputBytes = input?.inputBytes === undefined ? XLSX_IMPORT_LIMITS.inputBytes : input.inputBytes;
  const expandedBytes = input?.expandedBytes === undefined ? inputBytes * 5 : input.expandedBytes;
  for (const [name, value] of [["inputBytes", inputBytes], ["expandedBytes", expandedBytes]] as const)
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Excel取り込みの ${name} は正の安全な整数（バイト数）で指定してください`);
  return { ...XLSX_IMPORT_LIMITS, inputBytes, entryBytes: expandedBytes, totalBytes: expandedBytes,
    worksheetXmlBytes: expandedBytes, worksheetXmlText: expandedBytes,
    // Every XML element requires at least four bytes; the byte budget remains authoritative.
    worksheetXmlNodes: Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(expandedBytes / 4)) };
}
