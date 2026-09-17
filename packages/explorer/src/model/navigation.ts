import type { Entry } from "./entries";
import { getEntryPath, nameKey } from "./entries";
import { getEntryIndex, type EntryIndex } from "./entry-index";
import { formatExplorerPath } from "./path";

/** IDs are exact. Paths are absolute addresses inside this Explorer's virtual root. */
export type ExplorerFileTarget =
  | Readonly<{ id: string; path?: never }>
  | Readonly<{ path: string; id?: never }>;

export type ExplorerShowFileOptions = Readonly<{ mode?: "select" | "preview" }>;

export type ExplorerNavigationErrorCode =
  | "invalid-target" | "invalid-path" | "not-found" | "not-file" | "not-folder"
  | "ambiguous-path" | "different-folders" | "invalid-hierarchy"
  | "not-ready" | "selection-disabled" | "selection-limit" | "preview-disabled" | "invalid-mode";

export type ExplorerNavigationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: ExplorerNavigationErrorCode; message: string }>;

/** These methods affect the active tab of the main view; they never modify files. */
export type ExplorerNavigationHandle = Readonly<{
  navigate(path: string): ExplorerNavigationResult;
  selectFiles(targets: readonly ExplorerFileTarget[]): ExplorerNavigationResult;
  showFile(target: ExplorerFileTarget, options?: ExplorerShowFileOptions): ExplorerNavigationResult;
}>;

type NavigationEntry = Pick<Entry, "id" | "parent" | "name" | "kind">;
type NavigationFailure = Extract<ExplorerNavigationResult, { ok: false }>;
type NavigationLocation = Readonly<{
  /** Null means clear the selection without navigating. */
  location: string | null;
  expanded: readonly string[];
  fileIds: readonly string[];
}>;
export type ExplorerNavigationResolution =
  | Readonly<{ ok: true; value: NavigationLocation }>
  | NavigationFailure;

class ResolutionError extends Error {
  constructor(readonly code: ExplorerNavigationErrorCode, message: string) { super(message); }
}
function fail(code: ExplorerNavigationErrorCode, message: string): never { throw new ResolutionError(code, message); }
const failure = (error: unknown): NavigationFailure => Object.freeze({ ok: false,
  code: error instanceof ResolutionError ? error.code : "invalid-hierarchy",
  message: error instanceof Error ? error.message : "フォルダの階層を確認できません",
});

function navigationIndex(entries: readonly NavigationEntry[]): EntryIndex<NavigationEntry> {
  const index = getEntryIndex(entries);
  if (index.byId.size !== entries.length || index.byId.has("root")) {
    fail("invalid-hierarchy", "ファイルやフォルダのIDが重複しているため、移動先を確認できません");
  }
  return index;
}

/** Check every segment for ambiguous names before resolving it, unlike an address-bar best match. */
function pathEntry(index: EntryIndex<NavigationEntry>, value: string, ambiguousNamesByParent: Map<string, ReadonlySet<string>>): NavigationEntry | null {
  if (typeof value !== "string") fail("invalid-path", "移動先の絶対パスを指定してください");
  const input = value.trim();
  if (!/^[\\/]/.test(input) || /^[\\/]{2}/.test(input) || /[\u0000-\u001f]/.test(input)) {
    fail("invalid-path", "このエクスプローラーのルートから始まる絶対パスを指定してください（例: /資料）");
  }
  const segments = input.split(/[\\/]+/).filter(Boolean);
  let entry: NavigationEntry | null = null;
  for (const [position, segment] of segments.entries()) {
    if (segment === ".") continue;
    if (segment === "..") {
      entry = !entry || entry.parent === "root" ? null : index.byId.get(entry.parent) ?? null;
      continue;
    }
    const parent = entry?.id ?? "root";
    const key = nameKey(segment);
    const names = index.namesByParent.get(parent);
    const match = names?.get(key);
    if (!match) fail("not-found", `「${segment}」が見つかりません`);
    let ambiguous = ambiguousNamesByParent.get(parent);
    if (!ambiguous) {
      // A batch may address thousands of siblings. Validate duplicate names once
      // per visited parent, then reuse the shared index for each path segment.
      const duplicates = new Set<string>();
      for (const child of index.childrenByParent.get(parent) ?? []) {
        const childKey = nameKey(child.name);
        if (names?.get(childKey) !== child) duplicates.add(childKey);
      }
      ambiguous = duplicates;
      ambiguousNamesByParent.set(parent, ambiguous);
    }
    if (ambiguous.has(key)) fail("ambiguous-path", `「${segment}」に一致する項目が複数あります。ファイルIDを指定してください`);
    entry = match;
    if (position < segments.length - 1 && entry.kind !== "folder") {
      fail("not-folder", `「${entry.name}」はファイルです。途中のパスにはフォルダを指定してください`);
    }
  }
  return entry;
}

function fileEntry(index: EntryIndex<NavigationEntry>, target: ExplorerFileTarget, ambiguousNamesByParent: Map<string, ReadonlySet<string>>): NavigationEntry {
  if (!target || typeof target !== "object" || Array.isArray(target) ||
    (Object.getPrototypeOf(target) !== Object.prototype && Object.getPrototypeOf(target) !== null)) {
    fail("invalid-target", "ファイルのIDまたは絶対パスを指定してください");
  }
  const keys = Reflect.ownKeys(target);
  if (keys.length !== 1 || (keys[0] !== "id" && keys[0] !== "path")) {
    fail("invalid-target", "ファイルのIDとパスは、どちらか一方だけ指定してください");
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, keys[0]);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !descriptor.value) {
    fail("invalid-target", "ファイルのIDまたは絶対パスを文字列で指定してください");
  }
  const entry = keys[0] === "id" ? index.byId.get(descriptor.value) : pathEntry(index, descriptor.value, ambiguousNamesByParent);
  if (keys[0] === "id" && descriptor.value === "root") fail("not-file", "ルートはフォルダです。ファイルを指定してください");
  if (entry === null) fail("not-file", "ルートはフォルダです。ファイルを指定してください");
  if (!entry) fail("not-found", "指定されたファイルが見つかりません");
  if (entry.kind !== "file") fail("not-file", `「${entry.name}」はフォルダです。ファイルを指定してください`);
  return entry;
}

function resolved(entries: readonly NavigationEntry[], index: EntryIndex<NavigationEntry>, location: string, fileIds: readonly string[]): ExplorerNavigationResolution {
  // Reuse the shared path validator for broken, cyclic or non-folder ancestor chains.
  formatExplorerPath(entries, location, index);
  return Object.freeze({ ok: true, value: Object.freeze({ location,
    expanded: Object.freeze(["root", ...getEntryPath(entries, location).map(entry => entry.id)]),
    fileIds: Object.freeze([...fileIds]),
  }) });
}

/** Resolve a folder without reading storage or changing the current tab. */
export function resolveExplorerNavigation(entries: readonly NavigationEntry[], path: string): ExplorerNavigationResolution {
  try {
    const index = navigationIndex(entries);
    const entry = pathEntry(index, path, new Map());
    if (entry && entry.kind !== "folder") fail("not-folder", `「${entry.name}」はファイルです。フォルダを指定してください`);
    return resolved(entries, index, entry?.id ?? "root", []);
  } catch (error) { return failure(error); }
}

/** Resolve all targets first. Failed batches never produce a partial selection. */
export function resolveExplorerFileTargets(entries: readonly NavigationEntry[], targets: readonly ExplorerFileTarget[]): ExplorerNavigationResolution {
  try {
    if (!Array.isArray(targets)) fail("invalid-target", "選択するファイルを配列で指定してください");
    if (!targets.length) return Object.freeze({ ok: true, value: Object.freeze({ location: null, expanded: Object.freeze([]), fileIds: Object.freeze([]) }) });
    const index = navigationIndex(entries);
    const ambiguousNamesByParent = new Map<string, ReadonlySet<string>>();
    const files: NavigationEntry[] = [];
    const ids = new Set<string>();
    let parent: string | undefined;
    for (const target of targets) {
      const file = fileEntry(index, target, ambiguousNamesByParent);
      if (parent !== undefined && file.parent !== parent) fail("different-folders", "一度に選択するファイルは、同じフォルダ内で指定してください");
      parent = file.parent;
      if (!ids.has(file.id)) { ids.add(file.id); files.push(file); }
    }
    return resolved(entries, index, parent!, files.map(file => file.id));
  } catch (error) { return failure(error); }
}
