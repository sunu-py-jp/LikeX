import type { ExplorerAction, ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";
import { formatExplorerPath } from "./path";

export type ExplorerEditMode = "view" | "requesting" | "edit";
export type ExplorerEditIntent = Readonly<{
  action: ExplorerAction["action"] | "upload" | "save";
  ids?: readonly string[];
  parent?: string;
  windowId?: string;
}>;
export type ExplorerEditRequest = Readonly<{
  action: ExplorerEditIntent["action"];
  ids: readonly string[];
  items: readonly ExplorerItemInfo[];
  windowId: string;
  destination?: ExplorerItemInfo;
  destinationId?: string;
  destinationPath?: string;
}>;
export type ExplorerEditContext = Readonly<{
  requestId: string;
  /** Remains live after permission is granted; aborts when the session ends. */
  signal: AbortSignal;
}>;
export type ExplorerEditResult = boolean | Readonly<{
  allowed: true;
  /** An authoritative fresh baseline, accepted only while the draft is clean. */
  entries?: readonly ExplorerEntry[];
}>;
export type ExplorerEditHandler = (
  request: ExplorerEditRequest,
  context: ExplorerEditContext,
) => ExplorerEditResult | Promise<ExplorerEditResult>;
export type ExplorerEditEndReason = "saved" | "discarded" | "refreshed" | "ended" | "cancelled" | "read-only" | "unmounted";
export type ExplorerEditModeEvent = Readonly<{
  type: "edit-mode";
  mode: ExplorerEditMode;
  reason: "request" | "granted" | "denied" | "error" | ExplorerEditEndReason;
  requestId: string;
  request: ExplorerEditRequest;
  message?: string;
}>;
export type ExplorerEditState = Readonly<{
  mode: ExplorerEditMode;
  requestId: string | null;
  error: string | null;
  /** Identifies the denied/failed request without reviving its ended session. */
  errorRequestId: string | null;
}>;

function cloneItem(item: ExplorerItemInfo): ExplorerItemInfo {
  return { ...item, source: item.source ? { ...item.source } : null };
}

export function cloneEditRequest(request: ExplorerEditRequest): ExplorerEditRequest {
  return { ...request, ids: [...request.ids], items: request.items.map(cloneItem),
    ...(request.destination ? { destination: cloneItem(request.destination) } : {}) };
}

export function createEditRequest(entries: readonly ExplorerEntry[], intent: ExplorerEditIntent): ExplorerEditRequest {
  const index = getEntryIndex(entries);
  const ids = [...new Set(intent.ids ?? [])];
  const items = ids.map(id => {
    const entry = index.byId.get(id);
    if (!entry) throw new Error("操作する項目が見つかりません");
    return describeEntry(entries, entry, index);
  });
  const request: ExplorerEditRequest = { action: intent.action, ids, items, windowId: intent.windowId ?? "main" };
  if (intent.parent === undefined) return request;
  const destinationPath = formatExplorerPath(entries, intent.parent, index);
  const destination = index.byId.get(intent.parent);
  return { ...request, destinationId: intent.parent, destinationPath,
    ...(destination ? { destination: describeEntry(entries, destination, index) } : {}) };
}
