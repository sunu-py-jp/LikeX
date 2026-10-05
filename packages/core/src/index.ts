export type { MaybePromise, OperationContext, EventHandler, SaveHandler, RefreshHandler, RequestHandler,
  EditMode, EditEndReason, EditPermission, EditRequestHandler } from "./contracts";
export { notifyHost } from "./notifications";
export { isPromiseLike, chainResult } from "./async";
export { resolveFeatureFlags } from "./features";
export { isRibbonDisplayMode, normalizeRibbonDisplayMode } from "./ribbon";
export type { RibbonDisplayMode } from "./ribbon";
export type { FeatureFlags } from "./features";
export { createPrimaryColorPalette } from "./primary-color";
export type { PrimaryColorPalette } from "./primary-color";
export { serializeStableJson } from "./stable-json";
export { collectConditionalConflicts } from "./conditional-edits";
export type { ConditionalEditConflict } from "./conditional-edits";
export type { StableJsonOptions } from "./stable-json";
export { createUnsavedChangesGuard } from "./unsaved-changes";
export type { UnsavedChangesGuard, UnsavedChangesGuardOptions } from "./unsaved-changes";
export { resolveContextMenuItems } from "./context-menu";
export type { ContextMenuExecutionMode, ContextMenuResult, ContextMenuItem, ContextMenuProvider,
  ContextMenuExecutionState, ContextMenuExecutionEvent, ContextMenuExecutionOutcome } from "./context-menu";
export { createContextMenuExecutor } from "./context-menu-executor";
export type { ContextMenuExecutor, ContextMenuExecutorOptions, ContextMenuApplyGuard } from "./context-menu-executor";
export { createZipArchive } from "./zip";
export type { ZipArchiveContent, ZipArchiveEntry, ZipArchiveOptions } from "./zip";

export * from "./ooxml";

export { createModelEditorController } from "./editor/create-model-editor-controller";
export type { ModelEditorController } from "./editor/create-model-editor-controller";
export type { ModelEditorAdapter, ModelEditorOptions, ModelEditorSnapshot, ModelEditorEvent, ModelEditorNotice, ModelEditorExecuteOptions, ModelEditorTaskContext } from "./editor/types";
export { inspectEmbeddedImage } from "./embedded-image";
export type { EmbeddedImageOptions } from "./embedded-image";
export { collectEmbeddedImageAssets, IMAGE_ASSET_LIMITS } from "./image-assets";
export type { EmbeddedImageAsset, EmbeddedImageCollection, EmbeddedImageCollectionOptions } from "./image-assets";
export { getDragScrollDelta, getDragInsertionIndex } from "./drag";
export type { DragPoint, DragBounds, DragScrollOptions } from "./drag";
export { CONNECTOR_PORTS, CONNECTOR_ARROWHEADS, isConnectorPort, isConnectorArrowhead, getConnectorPortPoint, getConnectorPortPoints, findNearestConnectorPort,
  getConnectorBounds, getConnectorRoute, isConnectorRouting, connectorLocalToWorld, connectorWorldToLocal } from "./connectors";
export type { ConnectorPoint, ConnectorPort, ConnectorArrowhead, ConnectorBinding, ConnectorEndpoint, ConnectorBox, ConnectorOutline,
  ConnectorPortPoint, ConnectorTarget, ConnectorSnap, ConnectorPath, ConnectorPathCommand, ConnectorRouting, ConnectorRoute, ConnectorRouteOptions } from "./connectors";
export { OFFICE_SHAPE_PRESETS, isOfficeShapePreset, getOfficeShapeGeometry, getOfficeShapeOutline } from "./office-shapes";
export type { OfficeShapePreset, OfficeShapeCategory, OfficeShapeGeometry } from "./office-shapes";
export { createTextSearchMatcher } from "./text-search";
export type { TextSearchQuery, TextSearchMatcher } from "./text-search";
// Import-safe on the server; the host supplies a DOM anchor when opening a menu.
export { openContextMenu } from "./browser";
export type { ContextMenuAction, ContextMenuSurfaceOptions } from "./browser";
