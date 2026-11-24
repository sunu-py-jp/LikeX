import { detectOfficeContainer, type OfficePackageSignal } from "../ooxml";
import type { SpreadsheetExcelImportInput } from "./types";

/** Excel formats that can be imported: OOXML workbooks and Excel 97–2003 binary workbooks. */
export type SpreadsheetExcelImportFormat = "xlsx" | "xls";
/** File names offered and accepted by the Excel import entry points. */
export const EXCEL_IMPORT_ACCEPT = ".xlsx,.xls";
export const EXCEL_IMPORT_FILE_MESSAGE = ".xlsx または .xls 形式のExcelファイルを選択してください";
export const isExcelImportFileName = (name: string): boolean => /\.(?:xlsx|xls)$/i.test(name);

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const fileName = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name : undefined;
function bytesFormat(input: unknown): SpreadsheetExcelImportFormat | undefined {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input, 0, Math.min(8, input.byteLength)) : undefined;
  return bytes && (bytes.byteLength >= 8 && CFB_SIGNATURE.every((value, index) => bytes[index] === value) ? "xls" : "xlsx");
}
/**
 * The format known without reading a file: binary input by its signature, files by their extension.
 * Events and progress labels use it, as they are published before any byte is read.
 */
export function guessExcelImportFormat(input: unknown): SpreadsheetExcelImportFormat {
  return bytesFormat(input) ?? (/\.xls$/i.test(fileName(input) ?? "") ? "xls" : "xlsx");
}
/**
 * Decides which importer reads the input. Only a compound file is routed to the binary reader;
 * everything else stays on the XLSX path, which reports unusable input in its established wording.
 * A .xlsx name is not sniffed, so that path behaves exactly as before.
 */
export async function resolveExcelImportFormat(input: SpreadsheetExcelImportInput, signal?: OfficePackageSignal): Promise<SpreadsheetExcelImportFormat> {
  const known = bytesFormat(input);
  if (known) return known;
  if (/\.xlsx$/i.test(fileName(input) ?? "")) return "xlsx";
  try { return await detectOfficeContainer(input, signal) === "cfb" ? "xls" : "xlsx"; }
  catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
    return "xlsx";
  }
}
