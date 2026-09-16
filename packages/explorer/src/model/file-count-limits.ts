import type { ExplorerEntry } from "./draft";
import type { ExplorerUploadRejectionReason, ResolvedExplorerUploadOptions } from "./upload";

/** Folders never consume file capacity, regardless of their depth or save status. */
export function countFiles(entries: readonly ExplorerEntry[]): number {
  let count = 0;
  for (const entry of entries) if (entry.kind === "file") count++;
  return count;
}

/** Existing over-limit drafts remain editable as long as their file count does not increase. */
export function totalFileCountRejection(
  currentCount: number,
  addedCount: number,
  maxTotalFiles: number | undefined,
): Extract<ExplorerUploadRejectionReason, { code: "total-file-count-exceeded" }> | undefined {
  if (maxTotalFiles === undefined || addedCount === 0 || addedCount <= maxTotalFiles - currentCount) return;
  return {
    code: "total-file-count-exceeded",
    maxTotalFiles,
    message: `ファイルの総数が上限${maxTotalFiles}件を超えるため、追加できません`,
  };
}

/** Check one accepted import candidate after its overwrite/skip decision is known. */
export function uploadFileCountRejections(
  options: ResolvedExplorerUploadOptions,
  importedCount: number,
  currentCount: number,
  isNewFile: boolean,
): ExplorerUploadRejectionReason[] {
  const reasons: ExplorerUploadRejectionReason[] = [];
  const { maxFilesPerUpload, maxTotalFiles } = options;
  if (maxFilesPerUpload !== undefined && importedCount >= maxFilesPerUpload) reasons.push({
    code: "upload-file-count-exceeded",
    maxFilesPerUpload,
    message: `1回に取り込めるファイルの上限${maxFilesPerUpload}件を超えています`,
  });
  const totalRejection = totalFileCountRejection(currentCount, isNewFile ? 1 : 0, maxTotalFiles);
  if (totalRejection) reasons.push(totalRejection);
  return reasons;
}
