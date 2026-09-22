import {
  addFilesAsync, addFilesWithResultAsync, createDraftSnapshot, createExplorerUploadSession,
  prepareFilesWithProgressAsync, EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS,
  type ExplorerImportProgress, type ExplorerSnapshot, type ExplorerUploadOptions,
  type ExplorerUploadResult, type ExplorerUploadContentLimitsByExtension,
  type ExplorerUploadContentMetadata, type ExplorerUploadInspectFile,
} from "../src/model-entry";
import type { ExplorerProps, ExplorerUploadOptions as UiUploadOptions, useExplorerDraft } from "../src";

const limits: ExplorerUploadContentLimitsByExtension = {
  ".mp4": { maxDurationSeconds: 14_400 }, ".mp3": { maxDurationSeconds: 120.5 },
  ".pdf": { maxPages: 10 }, ".pptx": { maxSlides: 30 }, ".webm": false,
};
const inspectFile: ExplorerUploadInspectFile = async ({ file, kind, extension, signal }) => {
  const incoming: File = file;
  const aborted: boolean = signal.aborted;
  const metadata: ExplorerUploadContentMetadata = kind === "pdf" ? { kind, pages: 5 }
    : kind === "presentation" ? { kind, slides: 10 } : { kind, durationSeconds: 1 };
  void [incoming, aborted, extension];
  return metadata;
};
const options: ExplorerUploadOptions = { contentLimitsByExtension: limits, inspectFile };
const uiOptions: UiUploadOptions = options;
export const props: Pick<ExplorerProps, "upload"> = { upload: uiOptions };

export function asyncModelUploads(files: readonly File[], signal: AbortSignal) {
  const snapshot = createDraftSnapshot([]), session = createExplorerUploadSession();
  const result: Promise<{ snapshot: ExplorerSnapshot; result: ExplorerUploadResult }> =
    addFilesWithResultAsync(snapshot, files, "root", options, [], session, { signal });
  const onlySnapshot: Promise<ExplorerSnapshot> = addFilesAsync(snapshot, files, "root", options);
  const staged: AsyncGenerator<ExplorerImportProgress, { snapshot: ExplorerSnapshot; result: ExplorerUploadResult }> =
    prepareFilesWithProgressAsync(snapshot, files, "root", options, [], session, { signal });
  const inspecting: ExplorerImportProgress = { phase: "inspecting", completed: 0, total: files.length };
  return { result, onlySnapshot, staged, inspecting, defaultVideoDuration: EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS };
}

export function asyncHookUpload(draft: ReturnType<typeof useExplorerDraft>, files: readonly File[], signal: AbortSignal) {
  const result: Promise<ExplorerUploadResult | undefined> = draft.addAsync(files, "root", [], undefined, {
    signal, onProgress(progress) { const value: ExplorerImportProgress = progress; void value; },
  });
  return result;
}

// @ts-expect-error PDF content rules count pages, not playback duration.
const invalidPdf: ExplorerUploadContentLimitsByExtension = { ".pdf": { maxDurationSeconds: 1 } };
// @ts-expect-error Video content rules measure duration, not pages.
const invalidVideo: ExplorerUploadContentLimitsByExtension = { ".mp4": { maxPages: 1 } };
// @ts-expect-error Presentations count slides, not pages.
const invalidPresentation: ExplorerUploadContentLimitsByExtension = { ".pptx": { maxPages: 1 } };
// @ts-expect-error Unknown extensions cannot request a built-in metadata rule.
const invalidExtension: ExplorerUploadContentLimitsByExtension = { ".zip": { maxSlides: 1 } };
// @ts-expect-error A PDF inspector must return the page-count metadata shape.
const invalidMetadata: ExplorerUploadContentMetadata = { kind: "pdf", durationSeconds: 1 };
// @ts-expect-error Raw counts are not validated metadata results.
const invalidInspector: ExplorerUploadInspectFile = () => 10;
if (limits[".pdf"]) {
  // @ts-expect-error Nested content limits are readonly in the public contract.
  limits[".pdf"].maxPages = 20;
}
void [invalidPdf, invalidVideo, invalidPresentation, invalidExtension, invalidMetadata, invalidInspector];
