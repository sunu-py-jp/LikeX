import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ExplorerEntry as Entry } from "./model/draft";
import type { ExplorerDraftOptions } from "./state/use-explorer-draft";
import type { ExplorerFileReader } from "./model/file-content";
import type { ExplorerColorMode, ExplorerThemeOptions } from "./ui/explorer-theme";
import type { ExplorerOptions, ExplorerViewMode } from "./model/config";
import type { ExplorerItemInfo } from "./model/item-info";
import type { ExplorerPreviewHandler, ExplorerPreviewTrigger } from "./model/preview";
import type { ExplorerEventHandler } from "./model/events";
import type { ExplorerUploadOptions } from "./model/upload";
import type { ExplorerDownloadHandler } from "./model/download";
import type { ExplorerSearchHandler, ExplorerSearchOptions } from "./model/search";
import type { ContextMenuExecutionMode } from "./core";
import type { ExplorerContextMenuProvider } from "./model/context-menu";

export type ExplorerIconLocation = "list" | "tree" | "tab" | "destination" | "details" | "preview";

export type ExplorerIconContext = Readonly<{
  entry: ExplorerItemInfo;
  location: ExplorerIconLocation;
  view: ExplorerViewMode;
  selected: boolean;
  expanded: boolean;
  /** Existing icon or thumbnail. Returning null/undefined also uses this fallback. */
  defaultIcon: ReactElement;
}>;

/** Synchronous presentation only. Return a component when hooks or async data are needed. */
export type ExplorerIconRenderer = (
  context: ExplorerIconContext,
) => Exclude<ReactNode, Promise<unknown>>;

export type ExplorerSelectedFileMode = "select" | "preview";

export type ExplorerProps = ExplorerOptions & Pick<ExplorerDraftOptions, "onSave" | "onRefresh" | "onEditRequest"> & {
  /** Read on mount only. Change the React key to open another workspace. */
  initialEntries: readonly Entry[];
  /** Resolve an opaque content ID for previews and downloads. */
  readFile?: ExplorerFileReader;
  /** Delegate downloads to the host, with progress and an explicit terminal result. */
  onDownloadRequest?: ExplorerDownloadHandler;
  /** Replace the built-in preview with a host-owned dialog, card, or viewer. */
  onPreviewRequest?: ExplorerPreviewHandler;
  /** Add single-click preview on file names. Defaults to doubleClick. */
  previewTrigger?: ExplorerPreviewTrigger;
  /** Observe local operations and lifecycle notifications; does not persist or veto them. */
  onEvent?: ExplorerEventHandler;
  /** Restrictions checked before staging local files; omitted values are unrestricted. */
  upload?: ExplorerUploadOptions;
  /** Search on input (default) or submit. Optional debounce applies to external input searches. */
  search?: ExplorerSearchOptions;
  /** Replace name matching with host-owned search; return existing entry IDs in result order. */
  onSearchRequest?: ExplorerSearchHandler;
  /** Append conditional items to entry/background context menus. Prepare changes; do not mutate in the handler. */
  getContextMenuItems?: ExplorerContextMenuProvider;
  /** Defaults to block. Confirm permits concurrent edits and asks before applying; reject-if-changed rejects stale results. */
  contextMenuExecutionMode?: ContextMenuExecutionMode;
  /** Override file/folder icons. Null/undefined preserve the default icon or thumbnail. */
  renderIcon?: ExplorerIconRenderer;
  /** Optional label at the right of the tab bar. Omitted or blank values are hidden. */
  title?: string;
  /** Display name of the virtual root. Defaults to "ファイル". */
  rootLabel?: string;
  /** Folder path resolved on mount for the first and new tabs. Defaults to "/". */
  defaultPath?: string;
  /** First tab's folder path. Takes precedence over defaultPath; read on mount only. */
  initialPath?: string;
  /** File entry ID to select on mount. Without initialPath, opens the file's parent folder. */
  selectedFile?: string;
  /** Select only (default), or also request the built-in/host preview on first display. */
  selectedFileMode?: ExplorerSelectedFileMode;
  onDirtyChange?: (dirty: boolean) => void;
  /** Warn before document unload or explicit popup close while dirty. Defaults to true.
   * SPA navigation and unmount must be guarded by the host using onDirtyChange. */
  warnOnUnsavedChanges?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Defaults to light (or legacy theme.colorScheme); system follows OS changes. */
  colorMode?: ExplorerColorMode;
  theme?: ExplorerThemeOptions;
  "aria-label"?: string;
};

/** Browser window dimensions and screen coordinates; the browser has final control. */
export type ExplorerPopupOptions = Readonly<{
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}>;

export type ExplorerPopupControls = Readonly<{
  /** Call directly from a user event. An existing window is brought forward. */
  open: (event?: { currentTarget: EventTarget | null }) => boolean;
  close: () => void;
  /** True only after the Explorer has rendered in the new window. */
  isOpen: boolean;
  isOpening: boolean;
  error: string | null;
}>;

/** Separate launcher; Explorer itself remains an embedded view with no mode prop. */
export type ExplorerPopupProps = ExplorerProps & {
  renderTrigger: (controls: ExplorerPopupControls) => Exclude<ReactNode, Promise<unknown>>;
  onOpenChange?: (open: boolean) => void;
  windowOptions?: ExplorerPopupOptions;
};
