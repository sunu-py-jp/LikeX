import type { ExplorerAction, ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";

/** Operations that the host can allow or deny for one entry or destination. */
export type ExplorerEntryOperation =
  | "preview" | "download" | "copy" | "move" | "rename" | "delete" | "favorite"
  | "overwrite" | "createFile" | "createFolder" | "upload" | "save";

export type ExplorerEntryPermission = boolean | Readonly<{ allowed: boolean; message?: string }>;
/** Omitted operations are allowed. A denial can supply the host's own message. */
export type ExplorerEntryPermissions = Readonly<Partial<Record<ExplorerEntryOperation, ExplorerEntryPermission>>>;
/** The virtual root is a destination, not a synthetic file or folder. */
export type ExplorerEntryPermissionTarget = ExplorerItemInfo | Readonly<{ id: "root"; kind: "root"; path: "/" }>;
/** Synchronous: read current host state on each execution; promises are rejected. */
export type ExplorerEntryPermissionsResolver = (target: ExplorerEntryPermissionTarget) => ExplorerEntryPermissions | undefined;
export type ExplorerEntryPermissionCheck = Readonly<{ id: string; operation: ExplorerEntryOperation; recursive?: boolean }>;

export class ExplorerOperationDeniedError extends Error {
  readonly entryId: string;
  readonly operation: ExplorerEntryOperation;

  constructor(entryId: string, operation: ExplorerEntryOperation, message: string) {
    super(message);
    this.name = "ExplorerOperationDeniedError";
    this.entryId = entryId;
    this.operation = operation;
  }
}

const operationLabels: Record<ExplorerEntryOperation, string> = {
  preview: "プレビュー", download: "ダウンロード", copy: "コピー", move: "移動", rename: "名前の変更",
  delete: "削除", favorite: "お気に入りの変更", overwrite: "上書き", createFile: "ファイルの作成",
  createFolder: "フォルダの作成", upload: "アップロード", save: "保存",
};

function readPermissions(value: unknown): ExplorerEntryPermissions | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Promise) void value.catch(() => {});
  if (!value || typeof value !== "object" || Array.isArray(value) || "then" in value) throw new Error("Invalid permissions");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("Invalid permissions");
  const result: Partial<Record<ExplorerEntryOperation, ExplorerEntryPermission>> = {};
  for (const [key, permission] of Object.entries(value)) {
    if (!Object.hasOwn(operationLabels, key)) throw new Error("Invalid operation");
    const operation = key as ExplorerEntryOperation;
    if (permission === undefined) continue;
    if (typeof permission === "boolean") { result[operation] = permission; continue; }
    if (!permission || typeof permission !== "object" || Array.isArray(permission) || "then" in permission) throw new Error("Invalid permission");
    const { allowed, message } = permission;
    if (typeof allowed !== "boolean" || (message !== undefined && typeof message !== "string")) throw new Error("Invalid permission");
    result[operation] = { allowed, message };
  }
  return result;
}

/**
 * Check targets, their ancestors, and optionally their descendants atomically.
 * Each (entry, operation) is checked once; resolver payloads cannot mutate entries.
 * This is a local operation guard, not server-side authorization or a lock service.
 */
export function assertExplorerEntryPermissions(
  entries: readonly ExplorerEntry[],
  checks: readonly ExplorerEntryPermissionCheck[],
  resolver?: ExplorerEntryPermissionsResolver,
): void {
  const index = getEntryIndex(entries);
  const pending = new Map<string, Set<ExplorerEntryOperation>>();
  const expanded = new Map<ExplorerEntryOperation, Set<string>>();
  const add = (id: string, operation: ExplorerEntryOperation) => {
    const path = new Set<string>();
    let current = id;
    for (;;) {
      if (path.has(current)) throw new Error("フォルダの階層が循環しています");
      path.add(current);
      const entry = index.byId.get(current);
      if (current !== "root" && !entry) throw new Error("操作する項目が見つかりません");
      const operations = pending.get(current) ?? new Set<ExplorerEntryOperation>();
      if (operations.has(operation)) return;
      operations.add(operation);
      pending.set(current, operations);
      if (current === "root") return;
      current = entry!.parent;
    }
  };
  for (const check of checks) {
    if (!Object.hasOwn(operationLabels, check.operation)) throw new Error("対応していない操作です");
    add(check.id, check.operation);
    if (check.recursive) {
      const visited = expanded.get(check.operation) ?? new Set<string>();
      expanded.set(check.operation, visited);
      const descendants = [check.id];
      while (descendants.length) {
        const id = descendants.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        add(id, check.operation);
        for (const child of index.childrenByParent.get(id) ?? []) descendants.push(child.id);
      }
    }
  }
  if (!resolver) return;
  for (const [id, operations] of pending) {
    const entry = index.byId.get(id);
    let permissions: ExplorerEntryPermissions | undefined;
    let invalid = false;
    try {
      permissions = readPermissions(resolver(entry ? describeEntry(entries, entry, index) : { id: "root", kind: "root", path: "/" }));
    } catch {
      invalid = true;
    }
    for (const operation of operations) {
      const label = entry ? `「${entry.name}」` : "ルートフォルダ";
      if (invalid) throw new ExplorerOperationDeniedError(id, operation, `${label}の${operationLabels[operation]}の許可を確認できません`);
      const permission = permissions?.[operation];
      if (permission === false || (typeof permission === "object" && !permission.allowed)) {
        const message = typeof permission === "object" && permission.message?.trim()
          ? permission.message : `${label}の${operationLabels[operation]}は許可されていません`;
        throw new ExplorerOperationDeniedError(id, operation, message);
      }
    }
  }
}

/** Map GUI and command actions onto the same permission operations. */
export function checksForExplorerAction(
  entries: readonly ExplorerEntry[], action: ExplorerAction,
): ExplorerEntryPermissionCheck[] {
  const parent = action.parent ?? "root";
  if (action.action === "create" || action.action === "createFile") {
    return [{ id: parent, operation: action.action === "create" ? "createFolder" : "createFile" }];
  }
  const ids = [...new Set(action.ids ?? [])];
  const operation = action.action;
  const checks: ExplorerEntryPermissionCheck[] = ids.map(id => ({
    id, operation, recursive: operation !== "favorite",
  }));
  if (action.action === "copy" || action.action === "move") checks.push({ id: parent, operation: action.action });
  // Resolve missing selected IDs even when the caller uses this helper separately.
  const { byId } = getEntryIndex(entries);
  if (!ids.length || ids.some(id => !byId.has(id))) throw new Error("操作する項目が見つかりません");
  return checks;
}

function sameContent(before: ExplorerEntry, after: ExplorerEntry): boolean {
  if (before.kind !== after.kind || before.size !== after.size || before.mime !== after.mime) return false;
  const left = before.source, right = after.source;
  return left === right
    || (left?.kind === "existing" && right?.kind === "existing" && left.id === right.id)
    || (left?.kind === "local" && right?.kind === "local" && left.file === right.file);
}

/**
 * Derive checks against the before tree for net changes (including upload results).
 * Creation inside new folders checks the nearest pre-existing destination.
 * Copy sources and upload intent require their action checks as well: net changes
 * alone cannot distinguish a copied entry from another newly created entry.
 */
export function checksForExplorerChanges(
  before: readonly ExplorerEntry[], after: readonly ExplorerEntry[],
): ExplorerEntryPermissionCheck[] {
  const previous = getEntryIndex(before).byId;
  const current = getEntryIndex(after).byId;
  const checks: ExplorerEntryPermissionCheck[] = [];
  const existingParent = (id: string): string => {
    const visited = new Set<string>();
    let parent = id;
    while (parent !== "root" && !previous.has(parent)) {
      if (visited.has(parent)) throw new Error("フォルダの階層が循環しています");
      visited.add(parent);
      const entry = current.get(parent);
      if (!entry) throw new Error("親フォルダが見つかりません");
      parent = entry.parent;
    }
    return parent;
  };
  for (const entry of before) {
    if (!current.has(entry.id)) checks.push({ id: entry.id, operation: "delete", recursive: true });
  }
  for (const entry of after) {
    const original = previous.get(entry.id);
    if (!original) {
      checks.push({ id: existingParent(entry.parent), operation: entry.kind === "folder" ? "createFolder" : "createFile" });
      continue;
    }
    if (entry.name !== original.name) checks.push({ id: entry.id, operation: "rename", recursive: true });
    if (entry.parent !== original.parent) {
      checks.push({ id: entry.id, operation: "move", recursive: true }, { id: existingParent(entry.parent), operation: "move" });
    }
    if (entry.favorite !== original.favorite) checks.push({ id: entry.id, operation: "favorite" });
    if (!sameContent(original, entry)) checks.push({ id: entry.id, operation: "overwrite" });
  }
  return checks;
}
