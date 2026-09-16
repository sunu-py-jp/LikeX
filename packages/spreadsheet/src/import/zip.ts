import { openOfficePackage } from "../ooxml";
import type { OfficePackageArchive, OfficePackageInput, OfficePackageSignal } from "../ooxml";
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

export async function openXlsxArchive(input: OfficePackageInput, signal?: OfficePackageSignal): Promise<OfficePackageArchive> {
  const archive = await excelErrorContext(() => openOfficePackage(input, signal));
  return { paths: archive.paths, has: path => archive.has(path), read: path => excelErrorContext(() => archive.read(path)) };
}
