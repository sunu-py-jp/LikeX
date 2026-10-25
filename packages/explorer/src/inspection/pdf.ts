import type { ExplorerUploadContentMetadata, ExplorerUploadInspectFileRequest } from "../model/upload-content";
import { PdfBudget, invalidPdf } from "./pdf-budget";
import { readPdfPageCount } from "./pdf-document";

export async function inspectPdf({ file, signal, pdfInspectionLimits }: ExplorerUploadInspectFileRequest): Promise<ExplorerUploadContentMetadata> {
  signal.throwIfAborted();
  const budget = new PdfBudget(signal, pdfInspectionLimits), maximum = budget.limits.inputBytes;
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maximum) {
    const formatted = maximum % (1024 * 1024) === 0 ? `${maximum / (1024 * 1024)} MiB` : `${maximum} bytes`;
    throw new Error(`PDF情報の確認は${formatted}以下のファイルに対応しています。必要に応じてupload.pdfInspectionLimitsまたはupload.inspectFileを指定してください`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.length !== file.size || bytes.length > maximum) invalidPdf();
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") invalidPdf("PDFのヘッダーが不正です");
  // Resolve the newest cross-reference data and only the metadata required for
  // the page tree. Never fall back to an unbounded whole-document parser.
  const pages = await readPdfPageCount(bytes, budget);
  signal.throwIfAborted();
  return { kind: "pdf", pages };
}
