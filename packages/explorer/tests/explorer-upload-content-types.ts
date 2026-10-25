import {
  addFilesAsync, addFilesWithResultAsync, createDraftSnapshot, createExplorerUploadSession,
  prepareFilesWithProgressAsync, EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS,
  inspectExplorerUploadFile, EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS,
  type ExplorerImportProgress, type ExplorerSnapshot, type ExplorerUploadOptions,
  type ExplorerUploadResult, type ExplorerUploadContentLimitsByExtension,
  type ExplorerUploadContentMetadata, type ExplorerUploadInspectFile, type ExplorerPdfInspectionLimits,
} from "../src/model-entry";
import { inspectExplorerUploadFile as inspectFromUi, EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS as uiDefaults,
  type ExplorerProps, type ExplorerUploadOptions as UiUploadOptions, type ExplorerPdfInspectionLimits as UiPdfLimits,
  type useExplorerDraft } from "../src";

const limits: ExplorerUploadContentLimitsByExtension = {
  ".mp4": { maxDurationSeconds: 14_400 }, ".mp3": { maxDurationSeconds: 120.5 },
  ".pdf": { maxPages: 10 }, ".pptx": { maxSlides: 30 }, ".webm": false,
};
const pdfInspectionLimits: ExplorerPdfInspectionLimits = {
  inputBytes: 128 * 1024 * 1024, streamBytes: 32 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024,
  objects: 200_000, xrefEntries: 300_000, objectStreamObjects: 100_000, treeNodes: 100_000,
  values: 1_000_000, depth: 128, treeDepth: 512, sections: 256, filters: 8, work: 512 * 1024 * 1024,
  timeoutMs: 60_000, tokenLength: 2048, nameLength: 2048, numberLength: 64, integerDigits: 16,
  startXrefSearchBytes: 2048,
};
const uiPdfLimits: UiPdfLimits = pdfInspectionLimits;
const defaultPdfBytes: number = EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS.inputBytes;
const uiDefaultTimeout: number = uiDefaults.timeoutMs;
const builtInInspector: ExplorerUploadInspectFile = inspectExplorerUploadFile;
const uiInspector: ExplorerUploadInspectFile = inspectFromUi;
const inspectFile: ExplorerUploadInspectFile = async ({ file, kind, extension, signal, pdfInspectionLimits: incomingLimits }) => {
  const incoming: File = file;
  const aborted: boolean = signal.aborted;
  const metadata: ExplorerUploadContentMetadata = kind === "pdf" ? { kind, pages: 5 }
    : kind === "presentation" ? { kind, slides: 10 } : { kind, durationSeconds: 1 };
  const inherited: ExplorerPdfInspectionLimits | undefined = incomingLimits;
  void [incoming, aborted, extension, inherited];
  return metadata;
};
const options: ExplorerUploadOptions = { contentLimitsByExtension: limits, inspectFile, pdfInspectionLimits };
const uiOptions: UiUploadOptions = options;
export const props: Pick<ExplorerProps, "upload"> = { upload: uiOptions };
export function inspectPdf(file: File, signal: AbortSignal): Promise<ExplorerUploadContentMetadata> {
  return inspectExplorerUploadFile({ file, extension: ".pdf", kind: "pdf", signal, pdfInspectionLimits });
}

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
// @ts-expect-error Resource caps are numeric counts rather than byte-size strings.
const invalidPdfBytes: ExplorerPdfInspectionLimits = { inputBytes: "128 MiB" };
// @ts-expect-error Limits cannot be disabled by passing false.
const disabledPdfLimits: ExplorerUploadOptions = { pdfInspectionLimits: false };
// @ts-expect-error Only published budget names can be configured.
const unknownPdfLimit: ExplorerPdfInspectionLimits = { memory: 1024 };
// @ts-expect-error The shared defaults cannot be mutated through the public API.
EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS.timeoutMs = 0;
// @ts-expect-error Caller-provided settings are readonly as well.
pdfInspectionLimits.inputBytes = 1;
if (limits[".pdf"]) {
  // @ts-expect-error Nested content limits are readonly in the public contract.
  limits[".pdf"].maxPages = 20;
}
void [invalidPdf, invalidVideo, invalidPresentation, invalidExtension, invalidMetadata, invalidInspector,
  uiPdfLimits, defaultPdfBytes, uiDefaultTimeout, builtInInspector, uiInspector, invalidPdfBytes, disabledPdfLimits, unknownPdfLimit];
