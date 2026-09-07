import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";

export type ExplorerPreviewRequest = ExplorerItemInfo & Readonly<{ kind: "file" }>;
export type ExplorerPreviewHandler = (
  request: ExplorerPreviewRequest,
) => void | Promise<void>;
export type ExplorerPreviewTrigger = "doubleClick" | "click";

export function createPreviewRequest(
  entries: readonly ExplorerEntry[],
  id: string,
): ExplorerPreviewRequest | null {
  const entry = getEntryIndex(entries).byId.get(id);
  return entry?.kind === "file"
    ? { ...describeEntry(entries, entry), kind: "file" }
    : null;
}
