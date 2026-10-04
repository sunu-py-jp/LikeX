import type { ExplorerProps, ExplorerSelectionKind } from "../src/index";
import type { ExplorerSelectionKind as ModelSelectionKind, ExplorerNavigationErrorCode } from "../src/model-entry";

const kind: ExplorerSelectionKind = "file";
const modelKind: ModelSelectionKind = "folder";
const selections: NonNullable<ExplorerProps["selection"]>[] = [
  { kind, mode: "single" }, { kind: modelKind }, { kind: "both", checkboxes: false },
];
const rejectedKind: ExplorerNavigationErrorCode = "selection-kind";
void [selections, rejectedKind];
// @ts-expect-error Selection kinds describe files and folders only.
const invalid: ExplorerSelectionKind = "image";
void invalid;
