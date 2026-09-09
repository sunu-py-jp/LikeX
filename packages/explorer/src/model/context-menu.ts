import type { ReactNode } from "react";
import type { ContextMenuItem, ContextMenuProvider } from "../core";
import type { ExplorerAction, ExplorerEntry } from "./draft";
import type { ExplorerItemInfo } from "./item-info";
import type { ExplorerLocationInfo } from "./events";
import type { ExplorerFeatures } from "./config";
import { fileExtension } from "./text";

/** Captured when the menu opens. Data access always reads that snapshot. */
export type ExplorerContextMenuContext = Readonly<{
  target: Readonly<{ kind: "entry"; entry: ExplorerItemInfo }> |
    Readonly<{ kind: "background"; parentId: string | null }>;
  selectedEntries: readonly ExplorerItemInfo[];
  location: ExplorerLocationInfo;
  tabId: string;
  windowId: string;
  readOnly: boolean;
  features: Readonly<Required<ExplorerFeatures>>;
  /** Originating view; useful for a host dialog, also in detached windows. */
  container: HTMLElement | null;
  getEntries: () => readonly ExplorerItemInfo[];
  readFile: (entryId: string) => Promise<Blob>;
}>;

/** Prepared changes use the normal edit, upload validation and conflict gates. */
export type ExplorerContextMenuChange =
  | Readonly<{ type: "action"; action: ExplorerAction }>
  | Readonly<{ type: "upload"; files: readonly File[]; parentId: string }>;

export type ExplorerContextMenuItem = ContextMenuItem<ExplorerContextMenuContext, ExplorerContextMenuChange, ReactNode>;
export type ExplorerContextMenuProvider = ContextMenuProvider<ExplorerContextMenuContext, ExplorerContextMenuChange, ReactNode>;

/** Validate IDs against the current draft; never redirect to the current selection. */
export function validateExplorerContextMenuTarget(context: ExplorerContextMenuContext, change: ExplorerContextMenuChange, entries: readonly ExplorerEntry[]) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  if (context.target.kind === "entry") {
    const target = byId.get(context.target.entry.id);
    if (!target || target.kind !== context.target.entry.kind)
      throw new Error("操作対象がなくなったため、結果を反映できません。選び直してください");
  }
  if (!change || typeof change !== "object") throw new Error("メニューの処理結果が正しくありません");
  if (change.type === "upload") {
    if (!Array.isArray(change.files) || change.files.some(file => !file || typeof file.name !== "string" || typeof file.slice !== "function"))
      throw new Error("追加するファイルが正しくありません");
    if (change.parentId !== "root" && byId.get(change.parentId)?.kind !== "folder")
      throw new Error("追加先のフォルダがなくなったため、結果を反映できません");
  } else if (change.type === "action") {
    if (!change.action || !["create", "createFile", "rename", "move", "copy", "delete", "favorite"].includes(change.action.action))
      throw new Error("メニューの操作が正しくありません");
    if (change.action.ids !== undefined && (!Array.isArray(change.action.ids) || change.action.ids.some(id => !byId.has(id))))
      throw new Error("操作対象がなくなったため、結果を反映できません");
    if (change.action.action === "rename") {
      const target = byId.get(change.action.ids?.[0] ?? "");
      if (target?.kind === "file" && fileExtension(target.name) !== fileExtension(change.action.name ?? ""))
        throw new Error("名前の変更で拡張子を変更することはできません");
    }
  } else throw new Error("メニューの処理結果が正しくありません");
}
