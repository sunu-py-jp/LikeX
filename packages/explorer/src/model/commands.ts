import type { ExplorerAction } from "./draft";
import type { ExplorerItemInfo } from "./item-info";
import type { ExplorerEntryTarget } from "./navigation";

/** Operations on the mounted main pane's shared draft. None are queued for a closed popup. */
export type ExplorerCommandHandle = Readonly<{
  /** Isolated current metadata, or null while the main pane is unavailable. */
  getEntries(): readonly ExplorerItemInfo[] | null;
  /** Explicit targets only; never substitutes the current selection. False means no change. */
  execute(action: ExplorerAction): Promise<boolean>;
  /** Uses the same validation, conflict dialog, progress and edit gate as GUI import. */
  upload(files: readonly File[], parentId: string): Promise<boolean>;
  save(): Promise<boolean>;
  /** Discard all unsaved changes. This explicit command does not ask a second confirmation. */
  discard(): Promise<boolean>;
  /** Dirty drafts open the normal confirmation dialog; that initial call resolves false. */
  refresh(): Promise<boolean>;
  /** File download or folder ZIP. True means completed or handed off to the browser/host. */
  download(target: ExplorerEntryTarget): Promise<boolean>;
}>;
