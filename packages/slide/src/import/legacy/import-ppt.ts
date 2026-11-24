import { createOfficePackageFromParts, openCompoundFile, readCompoundFileTitle } from "../../core";
import type { OfficePackageInput } from "../../ooxml";
import { importSlidePptxPackage, type SlidePptxImportOptions, type SlidePptxImportResult } from "../import-pptx";
import { fail, openPptFile } from "./ppt-file";
import { writePptPackage } from "./ppt-pptx";

/** Keep the PowerPoint wording for failures of the shared container reader. */
async function powerPointContext<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Officeファイルを読み込めません:")) throw error;
    if (error.message.includes("複合ファイルではありません")) return fail(".ppt形式（PowerPoint 97–2003）のプレゼンテーションではありません");
    throw new Error(error.message.replace(/^Officeファイル/, "PowerPoint"), { cause: error });
  }
}

/**
 * Imports a PowerPoint 97–2003 presentation. The binary records are rewritten as the equivalent
 * PresentationML package and read by the PPTX importer, so limits, recovery and warnings are shared.
 * Macros are never loaded, encrypted files are rejected, and nothing is fetched or executed.
 * Animations are not converted; a presentation that has them is imported with a warning.
 */
export async function importSlidePpt(input: OfficePackageInput, options: SlidePptxImportOptions = {}): Promise<SlidePptxImportResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  // Whichever shared reader reports a failure in the binary format, it is worded as a PowerPoint failure.
  const { archive, notes } = await powerPointContext(async () => {
    const file = await openCompoundFile(input, signal);
    // A password-protected OOXML presentation is also a compound file, wrapping the encrypted package.
    if (file.has("EncryptedPackage") || file.has("EncryptionInfo")) return fail("パスワードで保護または暗号化されたファイルには対応していません");
    const source = openPptFile(file), converted = writePptPackage(source, readCompoundFileTitle(file));
    signal?.throwIfAborted();
    // A VBA project is listed among the document information; it is neither read nor run.
    const macros = source.children(source.documentRecord).some(record => record.type === 0x07d0 && source.children(record).some(item => item.type === 0x03ff));
    return { archive: createOfficePackageFromParts(converted.parts, { signal }), notes: [...(macros ? ["マクロを読み込まずに省略しました"] : []), ...converted.warnings] };
  });
  const result = await importSlidePptxPackage(archive, options);
  return { ...result, warnings: [...new Set([...notes, ...result.warnings])] };
}
