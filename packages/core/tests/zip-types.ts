import type { ZipArchiveEntry } from "../src/zip";
import { createZipArchive } from "../src/zip";

const entries: readonly ZipArchiveEntry[] = [
  { path: "folder", directory: true },
  { path: "folder/file.txt", content: new Blob(["text"]) },
  { path: "lazy.txt", content: async () => new Blob(["lazy"]) },
];
void createZipArchive(entries, { type: "application/zip", signal: new AbortController().signal });
// @ts-expect-error File entries require their content.
const missingContent: ZipArchiveEntry = { path: "missing.txt" };
// @ts-expect-error Directory entries cannot carry file content.
const directoryContent: ZipArchiveEntry = { path: "folder", directory: true, content: new Blob() };
void [missingContent, directoryContent];
