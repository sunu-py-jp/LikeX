import { createDraftSnapshot, type ExplorerEntry, type ExplorerSnapshot } from "./draft";
import { getEntryIndex } from "./entry-index";
import { normalizeEntryName } from "./entries";

const MAX_ENTRIES = 100_000;
const MAX_TEXT_LENGTH = 5_000_000;

function record(value: unknown): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("検索結果の項目情報が正しくありません");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("検索結果の項目情報は通常のオブジェクトで返してください");
  return Object.getOwnPropertyDescriptors(value);
}
function field(properties: Record<string, PropertyDescriptor>, name: string): unknown {
  const property = properties[name];
  if (!property || !("value" in property)) throw new Error("検索結果の項目情報に必要な値がありません");
  return property.value;
}

/** @internal Copy and validate a batch before counting it toward a search's cumulative budget. */
export function prepareExplorerSearchEntries(entries: readonly ExplorerEntry[]): Readonly<{
  entries: readonly ExplorerEntry[]; textLength: number;
}> {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw new Error("検索結果の項目情報は 100,000 件以内の一覧で返してください");
  let textLength = 0;
  const text = (value: unknown): string => {
    if (typeof value !== "string") throw new Error("検索結果の項目情報の文字列が正しくありません");
    textLength += value.length;
    if (textLength > MAX_TEXT_LENGTH) throw new Error("検索結果の項目情報は合計 5,000,000 文字以内で返してください");
    return value;
  };
  const copied = entries.map((entry): ExplorerEntry => {
    const properties = record(entry);
    const id = text(field(properties, "id")), parent = text(field(properties, "parent")), name = normalizeEntryName(text(field(properties, "name")));
    const kind = field(properties, "kind"), size = field(properties, "size"), favorite = field(properties, "favorite");
    if (!id || id === "root" || !parent || kind !== "file" && kind !== "folder")
      throw new Error("検索結果の項目 ID、親フォルダ、種類が正しくありません");
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || typeof favorite !== "number" || !Number.isFinite(favorite) || favorite < 0)
      throw new Error("検索結果の項目情報の数値が正しくありません");
    let source: ExplorerEntry["source"] = null;
    const inputSource = field(properties, "source");
    if (inputSource !== null) {
      const sourceProperties = record(inputSource), sourceKind = field(sourceProperties, "kind");
      if (sourceKind === "existing") {
        const sourceId = text(field(sourceProperties, "id"));
        if (!sourceId) throw new Error("検索結果のファイル参照が正しくありません");
        source = Object.freeze({ kind: "existing", id: sourceId });
      } else if (sourceKind === "local") {
        const file = field(sourceProperties, "file");
        if (typeof File === "undefined" || !(file instanceof File)) throw new Error("検索結果のファイル参照が正しくありません");
        text(file.name);
        source = Object.freeze({ kind: "local", file });
      } else throw new Error("検索結果のファイル参照が正しくありません");
    }
    return Object.freeze({ id, parent, name, kind, size, favorite,
      mime: text(field(properties, "mime")), createdAt: text(field(properties, "createdAt")), updatedAt: text(field(properties, "updatedAt")), source });
  });
  return Object.freeze({ entries: Object.freeze(copied), textLength });
}

/** Hydrate search entries and ancestors in any order without overwriting cached or local identities. */
export function mergeExplorerSearchEntries(baseline: ExplorerSnapshot, draft: ExplorerSnapshot,
  entries: readonly ExplorerEntry[]): { baseline: ExplorerSnapshot; draft: ExplorerSnapshot; addedCount: number } {
  const response = prepareExplorerSearchEntries(entries).entries;
  const before = getEntryIndex(baseline.entries), current = getEntryIndex(draft.entries);
  const seen = new Set<string>(), added: ExplorerEntry[] = [];
  for (const entry of response) {
    if (seen.has(entry.id)) throw new Error("検索結果に同じ項目 ID が重複しています");
    seen.add(entry.id);
    const original = before.byId.get(entry.id);
    if (original) {
      if (original.parent !== entry.parent || original.kind !== entry.kind)
        throw new Error("検索結果の ID が別の既存項目と競合しています");
      continue;
    }
    if (current.byId.has(entry.id)) throw new Error("検索結果の ID がローカルの新規項目と競合しています");
    added.push(entry);
  }
  if (!added.length) return { baseline, draft, addedCount: 0 };
  // Validate both complete cache trees before publishing either: a missing or
  // locally deleted ancestor, cycle or sibling-name conflict rejects the batch.
  const nextBaseline = createDraftSnapshot([...baseline.entries, ...added]);
  const nextDraft = createDraftSnapshot([...draft.entries, ...added]);
  return { baseline: nextBaseline, draft: nextDraft, addedCount: added.length };
}
