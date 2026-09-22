/** React-free Explorer data operations. Persistence and authorization belong to the caller. */
export {
  createSnapshot, createDraftSnapshot, applyAction, addFiles, addFilesWithResult,
  prepareFilesWithProgress, getSavePayload, hasChanges, isSameFolderMove,
  addFilesAsync, addFilesWithResultAsync, prepareFilesWithProgressAsync,
} from "./draft";
export type { ExplorerEntry, ExplorerSnapshot, ExplorerAction, ExplorerSavePayload } from "./draft";
export { describeEntry, describeEntries } from "./item-info";
export type { ExplorerItemInfo } from "./item-info";
export { assertExplorerEntryPermissions, checksForExplorerAction, checksForExplorerChanges, ExplorerOperationDeniedError } from "./entry-permissions";
export type {
  ExplorerEntryOperation, ExplorerEntryPermission, ExplorerEntryPermissions, ExplorerEntryPermissionTarget,
  ExplorerEntryPermissionsResolver, ExplorerEntryPermissionCheck,
} from "./entry-permissions";
export { formatExplorerPath, resolveExplorerPath } from "./path";
export { resolveExplorerNavigation, resolveExplorerFileTargets, resolveExplorerEntryTargets } from "./navigation";
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
