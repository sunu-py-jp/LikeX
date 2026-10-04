/** React-free Explorer data operations. Persistence and authorization belong to the caller. */
export {
  createSnapshot, createDraftSnapshot, applyAction, addFiles, addFilesWithResult,
  prepareFilesWithProgress, getSavePayload, hasChanges, isSameFolderMove,
  addFilesAsync, addFilesWithResultAsync, prepareFilesWithProgressAsync,
} from "./draft";
export type { ExplorerEntry, ExplorerSnapshot, ExplorerAction, ExplorerSavePayload } from "./draft";
export { mergeExplorerFolderEntries } from "./folder-loading";
export { mergeExplorerSearchEntries } from "./search-entries";
export type { ExplorerFolderLoadRequest, ExplorerFolderLoadContext, ExplorerFolderLoadHandler, ExplorerFolderLoadingOptions,
  ExplorerFolderLoadOptions, ExplorerFolderLoadState, ExplorerFolderLoadEvent } from "./folder-loading";
export { describeEntry, describeEntries } from "./item-info";
export type { ExplorerItemInfo } from "./item-info";
export { resolveExplorerPickerItems } from "./picker";
export type { ExplorerPickerKind, ExplorerPickerItem, ExplorerPickerRootItem, ExplorerPickerOptions,
  ExplorerPickerErrorCode, ExplorerPickerResult } from "./picker";
export { resolveExplorerSearchHits, resolveExplorerSearchIds } from "./search";
export type {
  ExplorerSearchConditions, ExplorerSearchOptions, ExplorerSearchRequest, ExplorerSearchContext,
  ExplorerSearchHit, ExplorerSearchResult, ExplorerSearchStream, ExplorerSearchBatch, ExplorerSearchResponse, ExplorerSearchHandler,
} from "./search";
export { assertExplorerEntryPermissions, checksForExplorerAction, checksForExplorerChanges, ExplorerOperationDeniedError } from "./entry-permissions";
export type {
  ExplorerEntryOperation, ExplorerEntryPermission, ExplorerEntryPermissions, ExplorerEntryPermissionTarget,
  ExplorerEntryPermissionsResolver, ExplorerEntryPermissionCheck,
} from "./entry-permissions";
export { formatExplorerPath, resolveExplorerPath } from "./path";
export { resolveExplorerNavigation, resolveExplorerFileTargets, resolveExplorerEntryTargets, resolveExplorerContainingFolder } from "./navigation";
export type {
  ExplorerEntryTarget, ExplorerFileTarget, ExplorerNavigationResult, ExplorerNavigationErrorCode,
  ExplorerNavigationResolution, ExplorerEntryTargetResolution,
} from "./navigation";
export { readEntryFile } from "./file-content";
export type { ExplorerFileReader } from "./file-content";
export { createExplorerUploadSession, ExplorerUploadValidationError, ExplorerUploadConflictError, ExplorerUploadInspectionRequiredError } from "./upload";
export { EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS } from "./upload-content";
export type {
  ExplorerUploadContentLimitsByExtension, ExplorerUploadContentMetadata, ExplorerUploadContentRejectionReason,
  ExplorerUploadContentExtension, ExplorerUploadContentKind, ExplorerUploadVideoExtension, ExplorerUploadAudioExtension,
  ExplorerUploadInspectFile, ExplorerUploadInspectFileRequest,
} from "./upload-content";
export type {
  ExplorerUploadOptions, ExplorerUploadConflict, ExplorerUploadDecision, ExplorerUploadSession,
  ExplorerUploadInvalidFileBehavior, ExplorerUploadResult, ExplorerImportProgress,
  ExplorerUploadRejection, ExplorerUploadRejectionReason,
} from "./upload";

export type { ExplorerDetailsColumn, ExplorerDetailsColumnWidths } from "./column-size";
export type { ExplorerSelectionKind } from "./config";
