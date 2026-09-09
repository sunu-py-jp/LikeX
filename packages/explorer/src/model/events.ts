import type { ExplorerAction, ExplorerSavePayload } from "./draft";
import type { ExplorerViewMode } from "./config";
import type { ExplorerItemInfo } from "./item-info";
import type { ExplorerPreviewRequest } from "./preview";
import type { ExplorerUploadRejection } from "./upload";
import type { ExplorerDownloadProgress } from "./download";
import type { ExplorerEditModeEvent } from "./edit-session";
import { notifyHost, type EventHandler } from "../core";

export type ExplorerLocationInfo =
  | Readonly<{ kind: "folder"; id: string; name: string; path: string }>
  | Readonly<{ kind: "favorites" | "recent"; id: null; name: string; path: null }>;

export type ExplorerChangeInfo = Readonly<{
  created: readonly ExplorerItemInfo[];
  updated: readonly ExplorerItemInfo[];
  deleted: readonly ExplorerItemInfo[];
}>;

/** A rejected batch has no entry IDs yet and leaves the complete draft unchanged. */
export type ExplorerUploadRejectedEvent = Readonly<{
  type: "upload";
  status: "rejected";
  parentId: string;
  parentPath: string;
  attemptedCount: number;
  rejections: readonly ExplorerUploadRejection[];
  message: string;
}>;

/** Invalid files or declined overwrites were omitted; all counts can be zero except the omissions. */
export type ExplorerUploadSkippedEvent = Readonly<{
  type: "upload";
  status: "skipped";
  parentId: string;
  parentPath: string;
  attemptedCount: number;
  addedCount: number;
  overwrittenCount: number;
  skippedCount: number;
  rejections: readonly ExplorerUploadRejection[];
  message: string;
}>;

/** Observe local edits and upload omissions; storage is still owned by onSave. */
export type ExplorerDraftEvent =
  | ExplorerEditModeEvent
  | ExplorerUploadRejectedEvent
  | ExplorerUploadSkippedEvent
  | Readonly<{
      type: "change";
      action: ExplorerAction["action"] | "upload";
      entries: readonly ExplorerItemInfo[];
      changes: ExplorerChangeInfo;
    }>
  | Readonly<{ type: "discard"; entries: readonly ExplorerItemInfo[] }>
  | Readonly<{ type: "save"; status: "start"; payload: ExplorerSavePayload }>
  | Readonly<{ type: "save"; status: "success"; entries: readonly ExplorerItemInfo[] }>
  | Readonly<{ type: "save"; status: "error"; message: string }>
  | Readonly<{ type: "refresh"; status: "start" }>
  | Readonly<{ type: "refresh"; status: "success"; entries: readonly ExplorerItemInfo[] }>
  | Readonly<{ type: "refresh"; status: "error"; message: string }>;

export type ExplorerDownloadRequest = ExplorerItemInfo;

/** Optional additions preserve existing start/success/error event consumers. */
type DownloadEventContext = Readonly<{ requestId?: string; external?: boolean }>;

export type ExplorerViewEvent =
  | Readonly<{ type: "window"; action: "detach" | "reattach" | "close" | "blocked"; windowId: string; tabIds: readonly string[]; sourceWindowId?: string; message?: string }>
  | Readonly<{ type: "navigate"; location: ExplorerLocationInfo }>
  | Readonly<{ type: "selection"; ids: readonly string[]; entries: readonly ExplorerItemInfo[] }>
  | Readonly<{
      type: "tabs";
      activeTabId: string;
      tabs: readonly Readonly<{ id: string; title: string }>[];
    }>
  | Readonly<{
      type: "view";
      mode: ExplorerViewMode;
      compact: boolean;
      query: string;
      sort: Readonly<{ key: "name" | "updatedAt" | "extension" | "size"; asc: boolean }>;
    }>
  | Readonly<{ type: "details"; entry: ExplorerItemInfo | null }>
  | Readonly<{ type: "clipboard"; action: "copy" | "move"; ids: readonly string[] }>
  | Readonly<{ type: "preview"; request: ExplorerPreviewRequest; external: boolean }>
  | (Readonly<{ type: "download"; status: "start"; request: ExplorerDownloadRequest }> & DownloadEventContext)
  | (Readonly<{ type: "download"; status: "success"; request: ExplorerDownloadRequest; result?: Readonly<{ status: "handed-off" | "completed"; message?: string }> }> & DownloadEventContext)
  | (Readonly<{ type: "download"; status: "error"; request: ExplorerDownloadRequest; message: string }> & DownloadEventContext)
  | Readonly<{ type: "download-progress"; requestId: string; external: boolean; request: ExplorerDownloadRequest; progress: ExplorerDownloadProgress }>
  | Readonly<{ type: "download-cancelled"; requestId: string; external: boolean; request: ExplorerDownloadRequest; reason: string; message: string }>;

/** Child-window UI events include their window ID; draft/save events are workspace-wide. */
export type ExplorerEvent = ExplorerDraftEvent | (ExplorerViewEvent & Readonly<{ windowId?: string }>);

export type ExplorerEventHandler = EventHandler<ExplorerEvent>;

/** Observer failures never roll back an edit or turn a successful save into a failure. */
export function dispatchExplorerEvent(
  handler: ExplorerEventHandler | undefined,
  event: ExplorerEvent,
) {
  notifyHost(handler, event);
}
