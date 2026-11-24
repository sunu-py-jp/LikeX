import { ByteReader, createOfficePackageFromParts, officeArtRecords, openCompoundFile, readCompoundFileTitle, readOfficeArtImage } from "../../core";
import type { OfficePackageInput } from "../../ooxml";
import { importDocumentDocxPackage } from "../import-docx";
import type { DocumentDocxImportResult, DocumentDocxOptions } from "../types";
import { readDocContent } from "./doc-content";
import { writeDocPackage, type DocImage } from "./doc-docx";
import { fail, openDocFile, type DocFile } from "./doc-file";
import { readFonts, readLists, readStyles } from "./doc-properties";

const PICTURE_TYPES: Readonly<Record<string, [type: string, extension: string]>> = { png: ["image/png", "png"], jpeg: ["image/jpeg", "jpeg"], dib: ["image/bmp", "bmp"],
  emf: ["image/x-emf", "emf"], wmf: ["image/x-wmf", "wmf"], pict: ["image/x-pict", "pict"], tiff: ["image/tiff", "tiff"] };
const TWIP_EMU = 635;

/** Keep the Word wording for failures of the shared container reader. */
async function wordContext<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Officeファイルを読み込めません:")) throw error;
    if (error.message.includes("複合ファイルではありません")) return fail(".doc形式（Word 97–2003）の文書ではありません");
    throw new Error(error.message.replace(/^Officeファイル/, "Word文書"), { cause: error });
  }
}
/** An inline picture: a fixed header with its displayed size, then the drawing records holding the image. */
function readPicture(file: DocFile, offset: number): DocImage | undefined {
  const data = file.data;
  if (!data || offset + 68 > data.length) return undefined;
  try {
    const reader = new ByteReader(data, offset), size = reader.i32(), header = reader.u16(), mode = reader.i16();
    reader.seek(offset + 28);
    const width = reader.i16(), height = reader.i16(), scaleX = reader.u16() || 1000, scaleY = reader.u16() || 1000;
    let start = offset + header;
    if (mode === 0x66) start += 1 + data[start];
    for (const record of officeArtRecords(data, start, Math.min(data.length, offset + size))) {
      const image = readOfficeArtImage(data, record);
      if (!image) continue;
      const [type, extension] = PICTURE_TYPES[image.format];
      return { type, extension, data: image.data, width: Math.round(width * scaleX / 1000 * TWIP_EMU), height: Math.round(height * scaleY / 1000 * TWIP_EMU) };
    }
  } catch { /* A damaged picture is reported like any other unsupported drawing. */ }
  return undefined;
}

/**
 * Imports a Word 97–2003 document. The binary structures are rewritten as the equivalent
 * WordprocessingML package and read by the DOCX importer, so limits, recovery and warnings are shared.
 * Macros are never loaded, encrypted documents are rejected, and nothing is fetched or executed.
 */
export async function importDocumentDoc(input: OfficePackageInput, options: DocumentDocxOptions = {}): Promise<DocumentDocxImportResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  // Whichever shared reader reports a failure in the binary format, it is worded as a Word failure.
  const { archive, macros } = await wordContext(async () => {
    const file = await openCompoundFile(input, signal);
    // A password-protected OOXML document is also a compound file, wrapping the encrypted package.
    if (file.has("EncryptedPackage") || file.has("EncryptionInfo")) return fail("パスワードで保護または暗号化された文書には対応していません");
    const source = openDocFile(file), styles = readStyles(source), content = readDocContent(source, styles);
    signal?.throwIfAborted();
    const parts = writeDocPackage({ content, fonts: readFonts(source), lists: readLists(source), title: readCompoundFileTitle(file), picture: offset => readPicture(source, offset) });
    return { archive: createOfficePackageFromParts(parts, { signal }), macros: file.paths.some(path => /^Macros\//i.test(path)) };
  });
  const result = await importDocumentDocxPackage(archive, options);
  const warnings = macros ? ["マクロを読み込まずに省略しました"] : [];
  return { document: result.document, warnings: [...new Set([...warnings, ...result.warnings])] };
}
