import type { ExplorerPopupProps, ExplorerProps, ExplorerSelectedFileMode } from "../src";

export const initialSelectMode = "select" satisfies ExplorerSelectedFileMode;
export const initialPreviewMode = "preview" satisfies ExplorerSelectedFileMode;

export const explorerInitialFile = {
  initialEntries: [],
  defaultPath: "/articles",
  initialPath: "/articles/images",
  selectedFile: "file-cover",
  selectedFileMode: initialSelectMode,
} satisfies ExplorerProps;

export const explorerInitialPreview = {
  initialEntries: [],
  selectedFile: "file-report",
  selectedFileMode: initialPreviewMode,
  onPreviewRequest: (request) => {
    const id: string = request.id;
    const path: string = request.path;
    const extension: string = request.extension;
    void [id, path, extension];
  },
} satisfies ExplorerProps;

export const popupInitialFile = {
  ...explorerInitialFile,
  selectedFileMode: initialPreviewMode,
  renderTrigger: () => null,
} satisfies ExplorerPopupProps;

export const optionalInitialFile = { initialEntries: [] } satisfies ExplorerProps;
export const readOnlyInitialFile = { ...explorerInitialFile, readOnly: true } satisfies ExplorerProps;

// @ts-expect-error Initial file presentation is a closed public union.
export const invalidInitialFileMode = "open" satisfies ExplorerSelectedFileMode;
// @ts-expect-error The initial path is a virtual folder path string.
export const invalidInitialPath = { initialEntries: [], initialPath: 123 } satisfies ExplorerProps;
// @ts-expect-error selectedFile is an entry ID, not an entry object.
export const invalidSelectedFile = { initialEntries: [], selectedFile: { id: "file-report" } } satisfies ExplorerProps;
// @ts-expect-error Use selectedFileMode rather than a boolean preview flag.
export const invalidSelectedFileMode = { ...explorerInitialFile, selectedFileMode: true } satisfies ExplorerProps;
// @ts-expect-error Public props use camelCase.
export const invalidInitialPathName = { initialEntries: [], initialpath: "/articles" } satisfies ExplorerProps;
