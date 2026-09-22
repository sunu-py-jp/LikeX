import type { ExplorerHandle, ExplorerCommandHandle, ExplorerItemInfo } from "../src";
import { createDraftSnapshot, applyAction } from "../src/model-entry";

export function commands(handle: ExplorerHandle) {
  const api: ExplorerCommandHandle = handle;
  const entries: readonly ExplorerItemInfo[] | null = api.getEntries();
  const changed: Promise<boolean> = api.execute({ action: "rename", ids: ["file"], name: "Renamed.txt" });
  const uploaded: Promise<boolean> = api.upload([new File(["text"], "new.txt")], "root");
  const saved: Promise<boolean> = api.save();
  const discarded: Promise<boolean> = api.discard();
  const refreshed: Promise<boolean> = api.refresh();
  const downloaded: Promise<boolean> = api.download({ path: "/Folder" });
  handle.selectEntries([{ id: "folder" }, { id: "file" }]);
  handle.previewFile({ path: "/Folder/file.txt" });
  // @ts-expect-error Mounted editing uses the same closed action contract as the model.
  api.execute({ action: "undo" });
  // @ts-expect-error Upload destinations are explicit.
  api.upload([]);
  return { entries, changed, uploaded, saved, discarded, refreshed, downloaded };
}

export const created = applyAction(createDraftSnapshot([]), { action: "create", name: "Folder" });
