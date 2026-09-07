import type {
  ExplorerAction,
  ExplorerEditIntent,
  ExplorerEvent,
  ExplorerFeatures,
  ExplorerPopupProps,
  ExplorerProps,
} from "../src";

export const action = { action: "createFile", name: "Empty.txt", parent: "root" } satisfies ExplorerAction;
export const defaultName = { action: "createFile" } satisfies ExplorerAction;
export const features = { createFile: true, createFolder: false, uploadFiles: false } satisfies ExplorerFeatures;
export const intent = { action: "createFile", parent: "root" } satisfies ExplorerEditIntent;
export const props = { initialEntries: [], features, upload: { allowedExtensions: [".txt"], maxFileSizeBytes: 0 }, onSave() {} } satisfies ExplorerProps;
export const popup = { ...props, renderTrigger: () => null } satisfies ExplorerPopupProps;

// @ts-expect-error createFile is a boolean feature, independently of file upload.
export const invalidFeature = { createFile: "disabled" } satisfies ExplorerFeatures;
// @ts-expect-error Creation uses the documented action identifier.
export const invalidAction = { action: "newFile" } satisfies ExplorerAction;
// @ts-expect-error File creation accepts a filename, not file contents.
export const invalidContents = { action: "createFile", contents: "text" } satisfies ExplorerAction;

export function inspectCreation(event: ExplorerEvent) {
  if (event.type !== "change" || event.action !== "createFile") return;
  return event.changes.created.map(entry => ({ name: entry.name, path: entry.path, source: entry.source }));
}
