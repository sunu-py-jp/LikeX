import { createSnapshot, type ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";
import { DEFAULT_ROOT_LABEL } from "./path";

/** Kinds that may be returned when the user confirms a picker selection. */
export type ExplorerPickerKind = "file" | "folder" | "both";
export type ExplorerPickerRootItem = Readonly<{ kind: "root"; id: "root"; path: "/"; name: string }>;
export type ExplorerPickerItem = ExplorerItemInfo | ExplorerPickerRootItem;
export type ExplorerPickerOptions = Readonly<{
  /** Defaults to files only. The virtual root is accepted by folder and both. */
  kind?: ExplorerPickerKind;
  /** Defaults to one distinct item. Duplicate IDs do not consume this limit. */
  multiple?: boolean;
  rootLabel?: string;
}>;
export type ExplorerPickerErrorCode = "empty-selection" | "not-found" | "selection-kind" |
  "selection-limit" | "invalid-hierarchy" | "invalid-target";
export type ExplorerPickerResult = Readonly<{ ok: true; items: readonly ExplorerPickerItem[] }> |
  Readonly<{ ok: false; code: ExplorerPickerErrorCode; message: string }>;

class PickerError extends Error {
  constructor(readonly code: ExplorerPickerErrorCode, message: string) { super(message); }
}
function fail(code: ExplorerPickerErrorCode, message: string): never { throw new PickerError(code, message); }

function properties(value: unknown): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new Error("項目情報の形式が正しくありません");
  return Object.getOwnPropertyDescriptors(value);
}
function field(source: Record<string, PropertyDescriptor>, name: string): unknown {
  const descriptor = source[name];
  if (!descriptor || !("value" in descriptor)) throw new Error("項目情報に必要な値がありません");
  return descriptor.value;
}
function text(source: Record<string, PropertyDescriptor>, name: string): string {
  const value = field(source, name);
  if (typeof value !== "string") throw new Error("項目情報の文字列が正しくありません");
  return value;
}
function arrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("一覧を配列で指定してください");
  // Read data descriptors once: sparse arrays and accessors are not selections.
  const copied: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !("value" in descriptor)) throw new Error("一覧の項目が正しくありません");
    copied.push(descriptor.value);
  }
  return copied;
}
function copyEntry(value: unknown): ExplorerEntry {
  const source = properties(value);
  const kind = field(source, "kind"), size = field(source, "size"), favorite = field(source, "favorite");
  if (kind !== "file" && kind !== "folder" || typeof size !== "number" || !Number.isFinite(size) || size < 0 ||
    typeof favorite !== "number" || !Number.isFinite(favorite) || favorite < 0)
    throw new Error("項目の種類または数値が正しくありません");
  let content: ExplorerEntry["source"] = null;
  const rawContent = field(source, "source");
  if (rawContent !== null) {
    const contentProperties = properties(rawContent), contentKind = field(contentProperties, "kind");
    if (contentKind === "existing") {
      const id = text(contentProperties, "id");
      if (!id) throw new Error("ファイルの参照が正しくありません");
      content = { kind: "existing", id };
    } else if (contentKind === "local") {
      const file = field(contentProperties, "file");
      if (typeof File === "undefined" || !(file instanceof File)) throw new Error("ファイルの参照が正しくありません");
      content = { kind: "local", file };
    } else throw new Error("ファイルの参照が正しくありません");
  }
  return { id: text(source, "id"), parent: text(source, "parent"), name: text(source, "name"), kind, size,
    mime: text(source, "mime"), createdAt: text(source, "createdAt"), updatedAt: text(source, "updatedAt"), favorite, source: content };
}

/** Resolve an entire selection without fetching content or changing the draft.
 * Every failure is returned as data; it never includes partially resolved items. */
export function resolveExplorerPickerItems(entries: readonly ExplorerEntry[], ids: readonly string[],
  options: ExplorerPickerOptions = {}): ExplorerPickerResult {
  try {
    let kind: ExplorerPickerKind = "file", multiple = false, rootLabel = DEFAULT_ROOT_LABEL;
    let selected: string[];
    try {
      const config = properties(options);
      if (config.kind && field(config, "kind") !== undefined) {
        const value = field(config, "kind");
        if (value !== "file" && value !== "folder" && value !== "both") throw new Error();
        kind = value;
      }
      if (config.multiple && field(config, "multiple") !== undefined) {
        const value = field(config, "multiple");
        if (typeof value !== "boolean") throw new Error();
        multiple = value;
      }
      if (config.rootLabel && field(config, "rootLabel") !== undefined) rootLabel = text(config, "rootLabel").trim() || DEFAULT_ROOT_LABEL;
      const values = arrayValues(ids);
      if (values.some(id => typeof id !== "string" || !id)) throw new Error();
      selected = [...new Set(values as string[])];
    } catch { fail("invalid-target", "選択する項目の ID と選択条件を正しく指定してください"); }
    if (!selected.length) fail("empty-selection", "項目を選択してください");
    if (!multiple && selected.length > 1) fail("selection-limit", "選択できる項目は 1 件です");
    let copied: ExplorerEntry[];
    try { copied = createSnapshot(arrayValues(entries).map(copyEntry)).entries; }
    catch { fail("invalid-hierarchy", "項目情報またはフォルダの階層が正しくないため、選択を確定できません"); }
    const index = getEntryIndex(copied);
    const items = selected.map((id): ExplorerPickerItem => {
      if (id === "root") {
        if (kind === "file") fail("selection-kind", "ファイルを選択してください");
        return Object.freeze({ id: "root", kind: "root", path: "/", name: rootLabel });
      }
      const entry = index.byId.get(id);
      if (!entry) fail("not-found", "選択された項目が見つかりません");
      if (kind !== "both" && entry.kind !== kind)
        fail("selection-kind", kind === "file" ? "ファイルを選択してください" : "フォルダを選択してください");
      const item = describeEntry(copied, entry, index);
      if (item.source) Object.freeze(item.source);
      return Object.freeze(item);
    });
    return Object.freeze({ ok: true, items: Object.freeze(items) });
  } catch (error) {
    return Object.freeze({ ok: false, code: error instanceof PickerError ? error.code : "invalid-target",
      message: error instanceof PickerError ? error.message : "選択された項目を確認できません" });
  }
}
