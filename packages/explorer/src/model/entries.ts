import { getEntryIndex, subtreeEntries } from "./entry-index";
import { entryDateFormat, fileExtension, nameKey } from "./text";
export { nameKey } from "./text";
export { subtreeEntries } from "./entry-index";

export type Entry = {
  id: string;
  parent: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  favorite: number;
};

/** Derived metadata: names are authoritative even when a caller supplies a stale extension. */
export function entryExtension(entry: Pick<Entry, "kind" | "name">): string {
  return entry.kind === "file" ? fileExtension(entry.name) : "";
}
/** Normalize whitespace and Unicode, then reject unsupported entry names. */
export function normalizeEntryName(value: unknown): string {
  if (typeof value !== "string") throw new Error("名前を入力してください");
  const name = value.trim().normalize("NFC");
  if (
    !name ||
    name.length > 180 ||
    /[\\/\\\\:*?"<>|\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name)
  )
    throw new Error(
      "名前は180文字以内で、使用できない記号や末尾のピリオドを含めずに入力してください",
    );
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(name))
    throw new Error("この名前は使用できません");
  return name;
}
export function selectionRoots<T extends Pick<Entry, "id" | "parent">>(
  entries: readonly T[],
  ids: readonly string[],
): T[] {
  const selected = new Set(ids);
  const { byId, positions } = getEntryIndex(entries);
  return [...selected].flatMap(id => {
    const entry = byId.get(id);
    if (!entry) return [];
    let parent = entry.parent;
    const seen = new Set<string>();
    while (parent !== "root" && !seen.has(parent)) {
      if (selected.has(parent)) return [];
      seen.add(parent);
      parent = byId.get(parent)?.parent ?? "root";
    }
    return [entry];
  }).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}

export function validateDestination<
  T extends Pick<Entry, "id" | "parent" | "kind">,
>(entries: readonly T[], roots: readonly T[], destination: string) {
  const { byId } = getEntryIndex(entries);
  if (destination !== "root" && byId.get(destination)?.kind !== "folder")
    throw new Error("移動先のフォルダが見つかりません");
  const rootIds = new Set(roots.map(entry => entry.id));
  const seen = new Set<string>();
  let current = destination;
  while (current !== "root" && !seen.has(current)) {
    if (rootIds.has(current)) throw new Error("フォルダ自身や、その中のフォルダには移動・コピーできません");
    seen.add(current);
    current = byId.get(current)?.parent ?? "root";
  }
}

export function uniqueName(
  entries: readonly Pick<Entry, "id" | "parent" | "name">[],
  parent: string,
  name: string,
  exclude?: string,
): string {
  const names = new Set(
    entries
      .filter((e) => e.parent === parent && e.id !== exclude)
      .map((e) => nameKey(e.name)),
  );
  if (!names.has(nameKey(name))) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!names.has(nameKey(next))) return next;
  }
}
/** Return the ancestor entries followed by the entry itself, in root-first order. */
export function getEntryPath<T extends Pick<Entry, "id" | "parent">>(
  entries: readonly T[],
  id: string,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  const { byId } = getEntryIndex(entries);
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    result.push(current);
    seen.add(current.id);
    current = byId.get(current.parent);
  }
  return result.reverse();
}
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const formatEntryDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid Date" : entryDateFormat.format(date);
};

/** @deprecated Use normalizeEntryName; this normalizes and validates instead of returning a boolean. */
export const validName = normalizeEntryName;
/** @deprecated Use subtreeEntries; the result includes the selected entry itself. */
export const descendants: <T extends Pick<Entry, "id" | "parent">>(entries: readonly T[], id: string) => T[] = subtreeEntries;
/** @deprecated Use getEntryPath; the result is an entry array rather than a path string. */
export const pathOf = getEntryPath;
/** @deprecated Use formatEntryDate; this returns a display label rather than a timestamp. */
export const stamp = formatEntryDate;
