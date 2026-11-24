import { detectOfficeContainer, type OfficePackageInput } from "../ooxml";
import { importDocumentDocx } from "./import-docx";
import { importDocumentDoc } from "./legacy/import-doc";
import type { DocumentDocxImportResult, DocumentDocxOptions } from "./types";

/** Word formats that can be imported: OOXML documents and Word 97–2003 binary documents. */
export type DocumentWordImportFormat = "docx" | "doc";
/** File names offered and accepted by the Word import entry points. */
export const WORD_IMPORT_ACCEPT = ".docx,.doc";
export const WORD_IMPORT_FILE_MESSAGE = ".docx または .doc 形式のWord文書を選択してください";
export const isWordImportFileName = (name: string): boolean => /\.(?:docx|doc)$/i.test(name);

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const fileName = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name : undefined;
function bytesFormat(input: unknown): DocumentWordImportFormat | undefined {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input, 0, Math.min(8, input.byteLength)) : undefined;
  return bytes && (bytes.byteLength >= 8 && CFB_SIGNATURE.every((value, index) => bytes[index] === value) ? "doc" : "docx");
}
/** The format known without reading a file: binary input by its signature, files by their extension. */
export function guessWordImportFormat(input: unknown): DocumentWordImportFormat {
  return bytesFormat(input) ?? (/\.doc$/i.test(fileName(input) ?? "") ? "doc" : "docx");
}
/**
 * Imports a Word document in either supported format. Only a compound file is routed to the
 * binary reader; a .docx name and all other content stay on the DOCX path with its established messages.
 */
export async function importDocumentWord(input: OfficePackageInput, options: DocumentDocxOptions = {}): Promise<DocumentDocxImportResult> {
  options.signal?.throwIfAborted();
  const name = fileName(input);
  let format = bytesFormat(input);
  if (!format && name !== undefined && /\.docx$/i.test(name)) format = "docx";
  if (!format) {
    try { format = await detectOfficeContainer(input, options.signal) === "cfb" ? "doc" : "docx"; }
    catch (error) {
      if (options.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
      format = "docx";
    }
  }
  if (format === "doc") return importDocumentDoc(input, options);
  // Content decides: a package under another name is read without the DOCX name check.
  const renamed = name !== undefined && !/\.docx$/i.test(name) && !(input instanceof ArrayBuffer) && !(input instanceof Uint8Array);
  return importDocumentDocx(renamed ? { size: input.size, arrayBuffer: () => input.arrayBuffer() } : input, options);
}
