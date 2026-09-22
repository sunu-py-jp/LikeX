import {
  assertExplorerEntryPermissions,
  checksForExplorerAction,
  checksForExplorerChanges,
  ExplorerOperationDeniedError,
  type ExplorerEntry,
  type ExplorerEntryOperation,
  type ExplorerEntryPermission,
  type ExplorerEntryPermissions,
  type ExplorerEntryPermissionsResolver,
  type ExplorerEntryPermissionTarget,
  type ExplorerEntryPermissionCheck,
} from "../src/model-entry";
import type { ExplorerEntryPermissionsResolver as UIResolver, ExplorerProps, ExplorerPopupProps } from "../src";

export const operation: ExplorerEntryOperation = "save";
export const denial: ExplorerEntryPermission = { allowed: false, message: "別の利用者が編集中です" };
export const permissions: ExplorerEntryPermissions = { delete: denial, copy: true };
export const resolver: ExplorerEntryPermissionsResolver = target => target.kind === "root"
  ? { createFile: false, createFolder: true, upload: true }
  : target.source?.kind === "existing" ? permissions : undefined;
export const uiResolver: UIResolver = resolver;
export const props: ExplorerProps = { initialEntries: [], onSave: () => {}, getEntryPermissions: resolver };
export const popup: Pick<ExplorerPopupProps, "getEntryPermissions"> = { getEntryPermissions: resolver };
export const check: ExplorerEntryPermissionCheck = { id: "folder", operation: "download", recursive: true };

export function checkEntries(entries: ExplorerEntry[]) {
  assertExplorerEntryPermissions(entries, [check], resolver);
  const actionChecks = checksForExplorerAction(entries, { action: "delete", ids: ["folder"] });
  const changesChecks = checksForExplorerChanges(entries, []);
  const error = new ExplorerOperationDeniedError("folder", "delete", "削除できません");
  const errorOperation: ExplorerEntryOperation = error.operation;
  return { actionChecks, changesChecks, errorOperation };
}

// @ts-expect-error Entry permissions are synchronous to recheck current host state at execution.
export const asynchronous: ExplorerEntryPermissionsResolver = async () => ({ delete: false });
// @ts-expect-error A permission callback returns an operation map, not a single decision.
export const booleanResolver: ExplorerEntryPermissionsResolver = () => false;
// @ts-expect-error Decision objects require allowed.
export const invalidDecision: ExplorerEntryPermission = { message: "ロック中" };
// @ts-expect-error Only supported operation names are accepted.
export const unsupported: ExplorerEntryOperation = "edit";
// @ts-expect-error Only known operations can appear in the map.
export const unsupportedMap: ExplorerEntryPermissions = { erase: false };
// @ts-expect-error Messages are plain strings.
export const invalidMessage: ExplorerEntryPermission = { allowed: false, message: 123 };

export function readonlyPayload(target: ExplorerEntryPermissionTarget) {
  // @ts-expect-error The permission target identifier is immutable.
  target.id = "changed";
  if (target.kind === "root") {
    const path: "/" = target.path;
    // @ts-expect-error The virtual root has no synthetic file source.
    void target.source;
    return path;
  }
  // @ts-expect-error The item name is immutable.
  target.name = "changed";
  if (target.source?.kind === "existing") {
    // @ts-expect-error The nested source payload is also immutable.
    target.source.id = "changed";
  }
  return target.extension;
}
