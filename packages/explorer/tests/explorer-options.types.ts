import type {
  ExplorerColorMode,
  ExplorerDraftOptions,
  ExplorerEntry,
  ExplorerEvent,
  ExplorerUploadOptions,
  ExplorerUploadConflict,
  ExplorerUploadDecision,
  ExplorerUploadSession,
  ExplorerUploadRejectedEvent,
  ExplorerUploadSkippedEvent,
  ExplorerUploadResult,
  ExplorerUploadInvalidFileBehavior,
  ExplorerUploadRejection,
  ExplorerUploadRejectionReason,
  ExplorerFeatures,
  ExplorerOptions,
  ExplorerProps,
  ExplorerPopupProps,
  ExplorerSelectionMode,
  ExplorerSelectionOptions,
  ExplorerUIOptions,
  ExplorerTheme,
  ExplorerThemeOptions,
  ExplorerThemeOverrides,
  ExplorerViewMode,
  ExplorerViewOptions,
} from "../src";
import { createExplorerUploadSession } from "../src";

export const features = { copy: false, move: true, preview: true, download: false } satisfies ExplorerFeatures;
export const selectionMode = "single" satisfies ExplorerSelectionMode;
export const selection = { mode: selectionMode, checkboxes: false } satisfies ExplorerSelectionOptions;
export const ui = { sidebar: false, contextMenu: true, rowActions: false, thumbnails: true } satisfies ExplorerUIOptions;
export const viewMode = "details" satisfies ExplorerViewMode;
export const view = { allowedModes: [viewMode, "large"], defaultMode: viewMode } satisfies ExplorerViewOptions;
export const options = { features, selection, ui, view } satisfies ExplorerOptions;
export const entryWithoutExtension = {
  id: "file", parent: "root", name: "File.TXT", kind: "file", size: 0, mime: "text/plain",
  createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", favorite: 0,
  source: { kind: "existing", id: "content-file" },
} satisfies ExplorerEntry;
export function entryExtensionTypes(entry: ExplorerEntry) {
  const extension: string | undefined = entry.extension;
  const supplied = { ...entry, extension: "txt" } satisfies ExplorerEntry;
  // @ts-expect-error Extension metadata is derived from the name, not editable in place.
  entry.extension = "pdf";
  // @ts-expect-error A supplied extension must be a string if present.
  const invalid = { ...entry, extension: 42 } satisfies ExplorerEntry;
  return { extension, supplied, invalid };
}
export const defaultOptions = {} satisfies ExplorerOptions;
export const props = { ...options, initialEntries: [], onSave: async () => {} } satisfies ExplorerProps;
export const viewerProps = { initialEntries: [] } satisfies ExplorerProps;
export const explicitReadOnlyProps = { ...props, readOnly: true } satisfies ExplorerProps;
export const viewerPopup = { initialEntries: [], renderTrigger: () => null } satisfies ExplorerPopupProps;
export const explicitReadOnlyPopup = { ...viewerPopup, readOnly: true, onSave: async () => {} } satisfies ExplorerPopupProps;
export const viewerDraft = { initialEntries: [] } satisfies ExplorerDraftOptions;
export const explicitReadOnlyDraft = { initialEntries: [], readOnly: true } satisfies ExplorerDraftOptions;
export const readOnlyOptions = { readOnly: true, features: { favorites: true, download: true } } satisfies ExplorerOptions;

// @ts-expect-error Read-only mode is a boolean, not a mode name.
export const invalidReadOnly = { ...viewerProps, readOnly: "readonly" } satisfies ExplorerProps;
// @ts-expect-error Omitting onSave is allowed; supplying a non-handler is not.
export const invalidOptionalSave = { ...viewerDraft, onSave: true } satisfies ExplorerDraftOptions;
export function readonlyHookType(hook: ReturnType<typeof import("../src").useExplorerDraft>) {
  const readOnly: boolean = hook.readOnly;
  return readOnly;
}

// @ts-expect-error Feature names are a closed public API.
export const unknownFeature = { paste: false } satisfies ExplorerFeatures;
// @ts-expect-error File-kind filtering has been removed from the public feature contract.
export const removedFilterFeature = { filter: false } satisfies ExplorerFeatures;
// @ts-expect-error Features accept booleans, not presentation states.
export const nonBooleanFeature = { copy: "hidden" } satisfies ExplorerFeatures;
// @ts-expect-error Selection mode must be none, single or multiple.
export const unknownSelection = { mode: "many" } satisfies ExplorerSelectionOptions;
// @ts-expect-error Checkbox visibility is a boolean independent of selection mode.
export const nonBooleanCheckboxes = { checkboxes: "hidden" } satisfies ExplorerSelectionOptions;
// @ts-expect-error A restricted view list must contain at least one mode.
export const emptyViews = { allowedModes: [] } satisfies ExplorerViewOptions;
// @ts-expect-error View IDs are limited to the supported eight modes.
export const unknownView = { allowedModes: ["gallery"] } satisfies ExplorerViewOptions;
// @ts-expect-error An unknown initial view is invalid even with the default allowed list.
export const unknownDefaultView = { defaultMode: "gallery" } satisfies ExplorerViewOptions;
// @ts-expect-error UI visibility accepts only the documented display settings.
export const unknownUI = { save: false } satisfies ExplorerUIOptions;
// @ts-expect-error Configuration belongs in the documented option groups.
export const unknownOption = { checkboxes: false } satisfies ExplorerOptions;

export const systemColorMode = "system" satisfies ExplorerColorMode;
export const legacyTheme = { background: "#ffffff", colorScheme: "dark" } satisfies Partial<ExplorerTheme>;
export const themeOverrides = { baseColor: "#112233", foreground: "#eeeeee" } satisfies ExplorerThemeOverrides;
export const themeOptions = {
  baseColor: "#ffffff", accent: "#0067c0", fontFamily: "Segoe UI",
  light: { baseColor: "#fffaf0" }, dark: themeOverrides,
} satisfies ExplorerThemeOptions;
export const themedExplorer = { ...props, colorMode: systemColorMode, theme: themeOptions } satisfies ExplorerProps;
export const legacyThemedExplorer = { ...props, theme: legacyTheme } satisfies ExplorerProps;
export const themedPopup = { ...props, colorMode: "dark", theme: themeOptions, renderTrigger: () => null } satisfies ExplorerPopupProps;

// @ts-expect-error Color modes are a closed union, not arbitrary strings.
export const unknownColorMode = "auto" satisfies ExplorerColorMode;
// @ts-expect-error Theme base colors are CSS color strings.
export const nonStringBaseColor = { baseColor: 123 } satisfies ExplorerThemeOptions;
// @ts-expect-error Mode overrides cannot recursively override other modes.
export const nestedThemeModes = { dark: { light: {} } } satisfies ExplorerThemeOptions;
// @ts-expect-error Per-mode overrides cannot choose another color scheme.
export const modeOverrideScheme = { colorScheme: "light" } satisfies ExplorerThemeOverrides;
// @ts-expect-error Base-color configuration is not a resolved palette token.
export const unresolvedPreset = { baseColor: "#ffffff" } satisfies Partial<ExplorerTheme>;


export const uploadOptions = {
  allowedExtensions: [".pdf", ".TXT", ".tar.gz"] as const,
  maxFileSizeBytes: 10 * 1024 * 1024,
} satisfies ExplorerUploadOptions;
export const unrestrictedUpload = {} satisfies ExplorerUploadOptions;
export const rejectAllUpload = { allowedExtensions: [] as const, maxFileSizeBytes: 0 } satisfies ExplorerUploadOptions;
export const restrictedExplorer = { ...props, upload: uploadOptions } satisfies ExplorerProps;
export const restrictedPopup = { ...props, upload: uploadOptions, renderTrigger: () => null } satisfies ExplorerPopupProps;
export const restrictedDraft = { initialEntries: [], onSave: async () => {}, upload: uploadOptions } satisfies ExplorerDraftOptions;
export const extensionReason = { code: "extension-not-allowed", allowedExtensions: [".pdf"], message: "許可されていない拡張子" } satisfies ExplorerUploadRejectionReason;
export const sizeReason = { code: "file-too-large", maxFileSizeBytes: 10, message: "サイズ超過" } satisfies ExplorerUploadRejectionReason;
export const rejectionFor = (file: File): ExplorerUploadRejection => ({
  file, name: file.name, relativePath: file.name, extension: "exe", size: file.size, reasons: [extensionReason, sizeReason],
});
export const rejectedUploadEventFor = (file: File) => ({
  type: "upload", status: "rejected", parentId: "root", parentPath: "/", attemptedCount: 1,
  rejections: [rejectionFor(file)], message: "追加できませんでした",
}) satisfies ExplorerUploadRejectedEvent;
export function readUploadEvent(event: ExplorerEvent) {
  if (event.type !== "upload") return undefined;
  if (event.status === "skipped") {
    const skipped: ExplorerUploadSkippedEvent = event;
    return { skippedStatus: skipped.status, addedCount: skipped.addedCount, destination: skipped.parentPath };
  }
  const rejectedStatus: "rejected" = event.status;
  return { rejectedStatus, destination: event.parentPath, file: event.rejections[0]?.file };
}

export const skipUploadMode = "skip" satisfies ExplorerUploadInvalidFileBehavior;
export const rejectBatchUploadMode = "reject-batch" satisfies ExplorerUploadInvalidFileBehavior;
export const skipUploadOptions = { ...uploadOptions, invalidFileBehavior: skipUploadMode } satisfies ExplorerUploadOptions;
export const skipExplorer = { ...props, upload: skipUploadOptions } satisfies ExplorerProps;
export const skipPopup = { ...props, upload: skipUploadOptions, renderTrigger: () => null } satisfies ExplorerPopupProps;
export const skipDraft = { initialEntries: [], onSave: async () => {}, upload: skipUploadOptions } satisfies ExplorerDraftOptions;
export const uploadResultFor = (file: File) => ({ attemptedCount: 2, addedCount: 1, overwrittenCount: 0, skippedCount: 0, rejections: [rejectionFor(file)] }) satisfies ExplorerUploadResult;
export const uploadSession: ExplorerUploadSession = createExplorerUploadSession();
export function readUploadConflict(hook: ReturnType<typeof import("../src").useExplorerDraft>, conflict: ExplorerUploadConflict, session: ExplorerUploadSession) {
  const overwrite = { fileIndex: conflict.fileIndex, existing: conflict.existing, action: "overwrite" } satisfies ExplorerUploadDecision;
  const skip = { ...overwrite, action: "skip" } satisfies ExplorerUploadDecision;
  // @ts-expect-error Collision decisions allow only overwrite or skip.
  const invalid = { ...overwrite, action: "rename" } satisfies ExplorerUploadDecision;
  const prepared = hook.prepareAdd([conflict.file], "root", [overwrite], session);
  const result: ExplorerUploadResult | undefined = hook.add([conflict.file], "root", [skip], session);
  return { prepared, result, invalid };
}
// @ts-expect-error Batch session tokens must be created through the public factory.
export const invalidUploadSession = {} satisfies ExplorerUploadSession;
export const skippedUploadEventFor = (file: File) => ({
  ...uploadResultFor(file), type: "upload", status: "skipped", parentId: "root", parentPath: "/", message: "1件を除外しました",
}) satisfies ExplorerUploadSkippedEvent;
export function readUploadResult(hook: ReturnType<typeof import("../src").useExplorerDraft>, file: File) {
  const result: ExplorerUploadResult | undefined = hook.add([file], "root");
  if (!result) return undefined;
  return { addedCount: result.addedCount, attemptedCount: result.attemptedCount, file: result.rejections[0]?.file };
}
export function readonlyInferredUploadResult(hook: ReturnType<typeof import("../src").useExplorerDraft>, file: File) {
  const result = hook.add([file], "root");
  if (!result) return;
  // @ts-expect-error The hook preserves the public readonly result type without a caller annotation.
  result.addedCount = 99;
  // @ts-expect-error The hook result also exposes readonly rejection arrays.
  result.rejections.push(result.rejections[0]);
}

// @ts-expect-error Upload behavior is a closed union, not an arbitrary string.
export const unknownUploadBehavior = "ignore" satisfies ExplorerUploadInvalidFileBehavior;
// @ts-expect-error Partial imports use invalidFileBehavior, not a boolean presentation flag.
export const booleanUploadBehavior = { invalidFileBehavior: true } satisfies ExplorerUploadOptions;
// @ts-expect-error A skipped event reports the actual number of files added.
export const incompleteSkippedEvent = { ...rejectedUploadEventFor({} as File), status: "skipped" } satisfies ExplorerUploadSkippedEvent;
export function readonlyUploadResultContract(result: ExplorerUploadResult, options: ExplorerUploadOptions) {
  // @ts-expect-error Result counts cannot be changed by consumers.
  result.addedCount = 99;
  // @ts-expect-error Result rejection arrays are readonly.
  result.rejections.push(result.rejections[0]);
  // @ts-expect-error Caller upload behavior is readonly.
  options.invalidFileBehavior = "skip";
}

// @ts-expect-error Extensions require the leading dot.
export const extensionWithoutDot = { allowedExtensions: ["pdf"] } satisfies ExplorerUploadOptions;
// @ts-expect-error MIME patterns are not extension rules.
export const mimeUploadRule = { allowedExtensions: ["image/*"] } satisfies ExplorerUploadOptions;
// @ts-expect-error Upload limits use bytes as numbers, not size strings.
export const stringUploadSize = { maxFileSizeBytes: "10 MB" } satisfies ExplorerUploadOptions;
// @ts-expect-error File count is outside the public upload restriction API.
export const unsupportedUploadCount = { maxFiles: 100 } satisfies ExplorerUploadOptions;
// @ts-expect-error A size rejection must include the numeric limit.
export const incompleteSizeRejection = { code: "file-too-large", message: "サイズ超過" } satisfies ExplorerUploadRejectionReason;
// @ts-expect-error Rejection reasons are a closed discriminated union.
export const unknownUploadReason = { code: "unsupported-mime", message: "形式エラー" } satisfies ExplorerUploadRejectionReason;
export function readonlyUploadContract(options: ExplorerUploadOptions, event: ExplorerUploadRejectedEvent) {
  // @ts-expect-error Caller configuration is readonly.
  options.maxFileSizeBytes = 1024;
  // @ts-expect-error The allowed suffix list is readonly.
  options.allowedExtensions?.push(".exe");
  // @ts-expect-error Event rejection arrays are readonly.
  event.rejections.push(event.rejections[0]);
  // @ts-expect-error Rejection metadata is readonly; File identity is retained.
  event.rejections[0].name = "changed.txt";
}
