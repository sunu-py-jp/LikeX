import { detectOfficeContainer, type OfficePackageInput } from "../ooxml";
import { importSlidePptx, type SlidePptxImportOptions, type SlidePptxImportResult } from "./import-pptx";
import { importSlidePpt } from "./legacy/import-ppt";

/** PowerPoint formats that can be imported: OOXML presentations and PowerPoint 97–2003 binary presentations. */
export type SlidePowerPointImportFormat = "pptx" | "ppt";
/** File names offered and accepted by the PowerPoint import entry points. */
export const POWERPOINT_IMPORT_ACCEPT = ".pptx,.ppt";
export const POWERPOINT_IMPORT_FILE_MESSAGE = ".pptx または .ppt 形式のPowerPointファイルを選択してください";
export const isPowerPointImportFileName = (name: string): boolean => /\.(?:pptx|ppt)$/i.test(name);

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const fileName = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name : undefined;
function bytesFormat(input: unknown): SlidePowerPointImportFormat | undefined {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input, 0, Math.min(8, input.byteLength)) : undefined;
  return bytes && (bytes.byteLength >= 8 && CFB_SIGNATURE.every((value, index) => bytes[index] === value) ? "ppt" : "pptx");
}
/** The format known without reading a file: binary input by its signature, files by their extension. */
export function guessPowerPointImportFormat(input: unknown): SlidePowerPointImportFormat {
  return bytesFormat(input) ?? (/\.ppt$/i.test(fileName(input) ?? "") ? "ppt" : "pptx");
}
/**
 * Imports a PowerPoint presentation in either supported format. Only a compound file is routed to the
 * binary reader; a .pptx name and all other content stay on the PPTX path with its established messages.
 */
export async function importSlidePowerPoint(input: OfficePackageInput, options: SlidePptxImportOptions = {}): Promise<SlidePptxImportResult> {
  options.signal?.throwIfAborted();
  const name = fileName(input);
  let format = bytesFormat(input);
  if (!format && name !== undefined && /\.(?:pptx|potx)$/i.test(name)) format = "pptx";
  if (!format) {
    try { format = await detectOfficeContainer(input, options.signal) === "cfb" ? "ppt" : "pptx"; }
    catch (error) {
      if (options.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
      format = "pptx";
    }
  }
  if (format === "ppt") return importSlidePpt(input, options);
  // Content decides: a package under another name is read without the PPTX name check.
  const renamed = name !== undefined && !/\.(?:pptx|potx)$/i.test(name) && !(input instanceof ArrayBuffer) && !(input instanceof Uint8Array);
  return importSlidePptx(renamed ? { size: input.size, arrayBuffer: () => input.arrayBuffer() } : input, options);
}
