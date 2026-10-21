import { openOfficePackageReader } from "../ooxml";
import { XLSX_IMPORT_LIMITS, type ResolvedXlsxImportLimits } from "./types";
import type { OfficePackageStreamingArchive } from "../ooxml";
import type { OfficePackageInput, OfficePackageSignal } from "../ooxml";
export type { OfficePackageArchive as XlsxArchive } from "../ooxml";

/** Keep the public Excel error context while sharing the bounded Office decoder. */
async function excelErrorContext<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Officeファイルを読み込めません:"))
      throw new Error(error.message.replace(/^Office/, "Excel"), { cause: error });
    throw error;
  }
}

/** The importer streams worksheets and verifies all remaining members before committing. */
export async function openXlsxStreamingArchive(input: OfficePackageInput, signal?: OfficePackageSignal, limits: ResolvedXlsxImportLimits = XLSX_IMPORT_LIMITS): Promise<OfficePackageStreamingArchive> {
  const archive = await excelErrorContext(() => openOfficePackageReader(input, signal, limits));
  return {
    paths: archive.paths, has: path => archive.has(path),
    // Metadata and images retain their smaller allocation budget; only worksheets stream larger parts.
    read: path => excelErrorContext(() => archive.read(path, XLSX_IMPORT_LIMITS.xmlBytes)),
    async *stream(path) {
      try { yield* archive.stream(path); }
      catch (error) { await excelErrorContext(async () => { throw error; }); }
    },
    validate: () => excelErrorContext(() => archive.validate()),
  };
}
