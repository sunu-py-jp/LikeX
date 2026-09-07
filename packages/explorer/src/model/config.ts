export type ExplorerFeature =
  | "favorites"
  | "recent"
  | "createFolder"
  | "createFile"
  | "uploadFiles"
  | "uploadFolders"
  | "copy"
  | "move"
  | "rename"
  | "delete"
  | "preview"
  | "download"
  | "details"
  | "search"
  | "sort"
  | "tabs"
  | "detachTabs"
  | "resizeSidebar"
  | "pathInput";

/** Omitted features remain enabled; false removes their UI and operations. */
export type ExplorerFeatures = Partial<Record<ExplorerFeature, boolean>>;
export type ExplorerSelectionMode = "none" | "single" | "multiple";
export type ExplorerSelectionOptions = {
  mode?: ExplorerSelectionMode;
  checkboxes?: boolean;
};
export type ExplorerUIOptions = {
  sidebar?: boolean;
  contextMenu?: boolean;
  rowActions?: boolean;
  thumbnails?: boolean;
};

export const EXPLORER_VIEW_MODES = [
  "extra-large", "large", "medium", "small", "list", "details", "tiles", "content",
] as const;
export type ExplorerViewMode = (typeof EXPLORER_VIEW_MODES)[number];
export type ExplorerViewOptions = {
  /** At least one mode is required when restricting the available views. */
  allowedModes?: readonly [ExplorerViewMode, ...ExplorerViewMode[]];
  /** Initial mode for new tabs; must be one of allowedModes when supplied. */
  defaultMode?: ExplorerViewMode;
};
export type ExplorerOptions = {
  /** Prevent draft changes while preserving browsing. Missing onSave also enables this. */
  readOnly?: boolean;
  features?: ExplorerFeatures;
  selection?: ExplorerSelectionOptions;
  ui?: ExplorerUIOptions;
  view?: ExplorerViewOptions;
};

export type ResolvedExplorerOptions = {
  readOnly: boolean;
  features: Required<ExplorerFeatures>;
  selection: Required<ExplorerSelectionOptions>;
  ui: Required<ExplorerUIOptions>;
  view: { allowedModes: readonly ExplorerViewMode[]; defaultMode: ExplorerViewMode };
};

const featureDefaults: Required<ExplorerFeatures> = {
  favorites: true,
  recent: true,
  createFolder: true,
  createFile: true,
  uploadFiles: true,
  uploadFolders: true,
  copy: true,
  move: true,
  rename: true,
  delete: true,
  preview: true,
  download: true,
  details: true,
  search: true,
  sort: true,
  tabs: true,
  detachTabs: true,
  resizeSidebar: true,
  pathInput: true,
};

/** Resolve per-instance options without storing or mutating host configuration. */
export function resolveExplorerOptions(options: ExplorerOptions = {}): ResolvedExplorerOptions {
  const readOnly = options.readOnly === true;
  const features = { ...featureDefaults };
  for (const key of Object.keys(features) as ExplorerFeature[]) {
    features[key] = options.features?.[key] ?? featureDefaults[key];
  }
  if (readOnly) {
    for (const feature of ["createFolder", "createFile", "uploadFiles", "uploadFolders", "copy", "move", "rename", "delete"] as const)
      features[feature] = false;
  }
  const mode = options.selection?.mode ?? "multiple";
  const allowedModes = [...new Set(options.view?.allowedModes ?? EXPLORER_VIEW_MODES)];
  if (!allowedModes.length || allowedModes.some(mode => !EXPLORER_VIEW_MODES.includes(mode))) {
    throw new Error("view.allowedModesには有効な表示形式を1つ以上指定してください");
  }
  const defaultMode = options.view?.defaultMode ??
    (allowedModes.includes("details") ? "details" : allowedModes[0]);
  if (!allowedModes.includes(defaultMode)) {
    throw new Error("view.defaultModeはview.allowedModesに含めてください");
  }
  return {
    readOnly,
    features,
    selection: {
      mode,
      checkboxes: mode !== "none" && (options.selection?.checkboxes ?? true),
    },
    ui: {
      sidebar: options.ui?.sidebar ?? true,
      contextMenu: options.ui?.contextMenu ?? true,
      rowActions: options.ui?.rowActions ?? true,
      thumbnails: options.ui?.thumbnails ?? true,
    },
    view: { allowedModes, defaultMode },
  };
}
