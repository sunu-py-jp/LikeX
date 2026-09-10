export const FAVORITES = Symbol("favorites");
export const RECENT = Symbol("recent");
export type ExplorerLocation = string | symbol;

export type ExplorerDialogState = {
  type: "create" | "createFile" | "move" | "copy" | "delete" | "discard" | "refresh" | "help";
  ids?: string[];
};
export type ExplorerClipboardState = { ids: string[]; action: "move" | "copy" } | null;
export type ExplorerNotification = import("../model/notifications").ExplorerNotification & {
  downloadRequestId?: string;
};
