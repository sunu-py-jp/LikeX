import { entryExtension, nameKey, selectionRoots, validateDestination, normalizeEntryName } from "./entries";
import { getEntryIndex, subtreeEntries } from "./entry-index";
import { fileExtension } from "./text";
import {
  createExplorerUploadSession, ExplorerUploadConflictError, isExplorerUploadSession,
  resolveUploadOptions, validateUploadFiles,
  type ExplorerUploadConflict, type ExplorerUploadDecision, type ExplorerUploadOptions, type ExplorerUploadResult, type ExplorerUploadSession,
} from "./upload";

/** File content is owned by the host or retained as an in-memory browser File. */
export type ExplorerEntry = {
  id: string;
  parent: string;
  name: string;
  /** Derived from name, lowercase without a dot; normalized on every draft boundary. */
  readonly extension?: string;
  kind: "file" | "folder";
  size: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  favorite: number;
  source:
    | { kind: "existing"; id: string }
    | { kind: "local"; file: File }
    | null;
};

export type ExplorerSnapshot = { entries: ExplorerEntry[] };
export type ExplorerSavePayload = {
  entries: ExplorerEntry[];
  changes: {
    created: ExplorerEntry[];
    updated: ExplorerEntry[];
    deleted: ExplorerEntry[];
  };
};
export type ExplorerAction = {
  action: "create" | "createFile" | "rename" | "move" | "copy" | "delete" | "favorite";
  ids?: string[];
  name?: string;
  parent?: string;
};

function cloneEntry(entry: ExplorerEntry): ExplorerEntry {
  return { ...entry, extension: entryExtension(entry), source: entry.source ? { ...entry.source } : null };
}

const immutableSnapshots = new WeakSet<ExplorerSnapshot>();

function immutableSnapshot(entries: ExplorerEntry[]): ExplorerSnapshot {
  for (const entry of entries) {
    if (Object.isFrozen(entry)) continue;
    if (entry.source) Object.freeze(entry.source);
    Object.freeze(entry);
  }
  Object.freeze(entries);
  const snapshot = Object.freeze({ entries });
  immutableSnapshots.add(snapshot);
  return snapshot;
}

/** Internal committed state is immutable; boundary copies stay caller-owned. */
export function createDraftSnapshot(entries: readonly ExplorerEntry[]): ExplorerSnapshot {
  return immutableSnapshot(createSnapshot(entries).entries);
}

function editSnapshot(snapshot: ExplorerSnapshot): ExplorerSnapshot {
  return immutableSnapshots.has(snapshot) ? snapshot : createSnapshot(snapshot.entries);
}
function finishEdit(snapshot: ExplorerSnapshot, entries: ExplorerEntry[]): ExplorerSnapshot {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const extension = entryExtension(entry);
    if (entry.extension !== extension) entries[index] = { ...entry, extension };
  }
  return immutableSnapshots.has(snapshot) ? immutableSnapshot(entries) : { entries };
}

function assertDestination(entries: readonly ExplorerEntry[], parent: string) {
  validateDestination(entries, [], parent);
}

const suffixCounters = new WeakMap<ReadonlyMap<string, ExplorerEntry>, Map<string, number>>();
function availableName(names: ReadonlyMap<string, ExplorerEntry>, name: string): string {
  const key = nameKey(name);
  if (!names.has(key)) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot < 160 ? name.slice(dot) : "";
  const base = extension ? name.slice(0, dot) : name;
  const counters = suffixCounters.get(names) ?? new Map<string, number>();
  suffixCounters.set(names, counters);
  for (let index = counters.get(key) ?? 2; ; index++) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, 180 - suffix.length - extension.length)}${suffix}${extension}`;
    if (!names.has(nameKey(candidate))) {
      counters.set(key, index + 1);
      return normalizeEntryName(candidate);
    }
  }
}

/** Clone host-owned data and reject trees that local operations cannot safely edit. */
export function createSnapshot(
  entries: readonly ExplorerEntry[],
): ExplorerSnapshot {
  const cloned = entries.map((entry) => cloneEntry({ ...entry, name: normalizeEntryName(entry.name) }));
  const byId = new Map<string, ExplorerEntry>();
  const siblingNames = new Map<string, Set<string>>();
  for (const entry of cloned) {
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id === "root" ||
      byId.has(entry.id)
    ) {
      throw new Error("項目の ID が空、重複、または予約済みです");
    }
    if (entry.kind !== "file" && entry.kind !== "folder")
      throw new Error("項目の種類が正しくありません");
    byId.set(entry.id, entry);
    const names = siblingNames.get(entry.parent) ?? new Set<string>();
    const key = nameKey(entry.name);
    if (names.has(key))
      throw new Error("同じフォルダに同じ名前の項目があります");
    names.add(key);
    siblingNames.set(entry.parent, names);
  }
  for (const entry of cloned) {
    if (entry.parent !== "root" && byId.get(entry.parent)?.kind !== "folder") {
      throw new Error("親フォルダが見つかりません");
    }
  }
  const checked = new Set<string>();
  for (const entry of cloned) {
    let current = entry;
    const path = new Set<string>();
    while (!checked.has(current.id)) {
      if (path.has(current.id))
        throw new Error("フォルダの階層が循環しています");
      path.add(current.id);
      if (current.parent === "root") break;
      current = byId.get(current.parent)!;
    }
    for (const id of path) checked.add(id);
  }
  return { entries: cloned };
}

/** Selected descendants travel with their parent, so only roots can change location. */
export function isSameFolderMove(
  entries: readonly ExplorerEntry[], ids: readonly string[], parent: string,
): boolean {
  const { byId } = getEntryIndex(entries);
  if (!ids.length || ids.some(id => !byId.has(id))) return false;
  return selectionRoots(entries, ids).every(entry => entry.parent === parent);
}

function newFolder(parent: string, name: string, now: string, id: string = crypto.randomUUID()): ExplorerEntry {
  return {
    id,
    parent,
    name,
    extension: "",
    kind: "folder",
    size: 0,
    mime: "",
    createdAt: now,
    updatedAt: now,
    favorite: 0,
    source: null,
  };
}

/** Apply one atomic local operation. The supplied snapshot is never mutated. */
export function applyAction(
  snapshot: ExplorerSnapshot,
  action: ExplorerAction,
  upload?: ExplorerUploadOptions,
): ExplorerSnapshot {
  const source = editSnapshot(snapshot);
  const index = getEntryIndex(source.entries);
  const { byId, positions } = index;
  const ids = [...new Set(action.ids ?? [])];
  if (action.action !== "create" && action.action !== "createFile" && (!ids.length || ids.some(id => !byId.has(id))))
    throw new Error("操作する項目が見つかりません");
  const roots = selectionRoots(source.entries, ids);
  const now = new Date().toISOString();
  const parent = action.parent ?? "root";
  const entries = [...source.entries];
  const siblingNames = new Map<string, Map<string, ExplorerEntry>>();
  const namesAt = (id: string) => {
    let names = siblingNames.get(id);
    if (!names) {
      names = new Map(index.namesByParent.get(id));
      siblingNames.set(id, names);
    }
    return names;
  };
  let changed = false;
  const replace = (entry: ExplorerEntry) => {
    entries[positions.get(entry.id)!] = entry;
    changed = true;
  };
  const insert = (entry: ExplorerEntry) => {
    entries.push(entry);
    namesAt(entry.parent).set(nameKey(entry.name), entry);
    changed = true;
  };
  switch (action.action) {
    case "create": {
      assertDestination(source.entries, parent);
      const name = normalizeEntryName(action.name);
      if (namesAt(parent).has(nameKey(name))) throw new Error("同じ名前の項目がすでにあります");
      insert(newFolder(parent, name, now));
      break;
    }
    case "createFile": {
      assertDestination(source.entries, parent);
      const name = normalizeEntryName(action.name === undefined ? "新しいファイル.txt" : action.name);
      if (namesAt(parent).has(nameKey(name))) throw new Error("同じ名前の項目がすでにあります");
      const mime = fileExtension(name) === "txt" ? "text/plain" : "application/octet-stream";
      const file = new File([], name, { type: mime, lastModified: Date.parse(now) });
      const options = resolveUploadOptions(upload);
      // A single named creation must either succeed or explain the rejection;
      // the batch-only skip policy must never report an uncreated file as success.
      validateUploadFiles([{ file, name, relativePath: name }], { ...options, invalidFileBehavior: "reject-batch" });
      insert({
        id: crypto.randomUUID(), parent, name, kind: "file", size: 0, mime,
        createdAt: now, updatedAt: now, favorite: 0, source: { kind: "local", file },
      });
      break;
    }
    case "rename": {
      if (ids.length !== 1) throw new Error("名前を変更する項目を1つ選択してください");
      const entry = byId.get(ids[0])!;
      const name = normalizeEntryName(action.name);
      const duplicate = namesAt(entry.parent).get(nameKey(name));
      if (duplicate && duplicate.id !== entry.id) throw new Error("同じ名前の項目がすでにあります");
      if (entry.name !== name) replace({ ...entry, name, updatedAt: now });
      break;
    }
    case "move":
    case "copy": {
      validateDestination(source.entries, roots, parent);
      for (const root of roots) {
        if (action.action === "move") {
          if (root.parent === parent) continue;
          if (namesAt(parent).has(nameKey(root.name)))
            throw new Error(`「${root.name}」が移動先にすでにあります`);
          namesAt(root.parent).delete(nameKey(root.name));
          const moved = { ...root, parent };
          namesAt(parent).set(nameKey(root.name), moved);
          replace(moved);
        } else {
          const tree = subtreeEntries(source.entries, root.id);
          const copiedIds = new Map(tree.map(entry => [entry.id, crypto.randomUUID()]));
          const name = availableName(namesAt(parent), root.name);
          for (const entry of tree) insert({
            ...cloneEntry(entry), id: copiedIds.get(entry.id)!,
            parent: entry.id === root.id ? parent : copiedIds.get(entry.parent)!,
            name: entry.id === root.id ? name : entry.name,
            createdAt: now, updatedAt: now, favorite: 0,
          });
        }
      }
      break;
    }
    case "delete": {
      const removed = new Set(roots.flatMap(root => subtreeEntries(source.entries, root.id).map(entry => entry.id)));
      return finishEdit(source, entries.filter(entry => !removed.has(entry.id)));
    }
    case "favorite": {
      for (const id of ids) {
        const entry = byId.get(id)!;
        replace({ ...entry, favorite: entry.favorite ? 0 : 1, updatedAt: now });
      }
      break;
    }
    default: throw new Error("対応していない操作です");
  }
  return changed ? finishEdit(source, entries) : source;
}

/** Stage browser files and optional webkitRelativePath folders without reading or uploading bytes. */
export function addFiles(
  snapshot: ExplorerSnapshot,
  files: readonly File[],
  parent: string,
  upload?: ExplorerUploadOptions,
  decisions: readonly ExplorerUploadDecision[] = [],
  session?: ExplorerUploadSession,
): ExplorerSnapshot {
  return addFilesWithResult(snapshot, files, parent, upload, decisions, session).snapshot;
}

type UploadInput = Readonly<{
  file: File;
  fileIndex: number;
  parts: readonly string[];
  name: string;
  relativePath: string;
}>;
type UploadSessionState = {
  parent: string;
  inputs: readonly Readonly<{ file: File; relativePath: string; size: number; mime: string }>[];
  now: string;
  allocations: Map<string, string>;
};
const uploadSessionStates = new WeakMap<ExplorerUploadSession, UploadSessionState>();

/** Retry metadata is scoped to an explicit batch token, never to committed entries. */
function uploadSessionState(session: ExplorerUploadSession, parent: string, inputs: readonly UploadInput[]) {
  if (!isExplorerUploadSession(session)) throw new Error("アップロードの確認セッションが正しくありません");
  const previous = uploadSessionStates.get(session);
  if (previous) {
    if (previous.parent !== parent || previous.inputs.length !== inputs.length ||
      previous.inputs.some((input, index) => {
        const next = inputs[index];
        return input.file !== next.file || input.relativePath !== next.relativePath ||
          input.size !== next.file.size || input.mime !== next.file.type;
      })) throw new Error("アップロードの対象が変わりました。ファイルを選び直してください");
    return previous;
  }
  const state: UploadSessionState = {
    parent,
    inputs: inputs.map(({ file, relativePath }) => ({ file, relativePath, size: file.size, mime: file.type })),
    now: new Date().toISOString(),
    allocations: new Map(),
  };
  uploadSessionStates.set(session, state);
  return state;
}

/** Confirmation is valid only for the complete entry the caller actually saw. */
function matchesUploadDecision(existing: ExplorerEntry, expected: ExplorerEntry): boolean {
  return equalEntry(existing, expected) && existing.createdAt === expected.createdAt && existing.updatedAt === expected.updatedAt;
}

/** Commit accepted files together; skipped inputs never create folders or IDs. */
export function addFilesWithResult(
  snapshot: ExplorerSnapshot,
  files: readonly File[],
  parent: string,
  upload?: ExplorerUploadOptions,
  decisions: readonly ExplorerUploadDecision[] = [],
  session: ExplorerUploadSession = createExplorerUploadSession(),
): { snapshot: ExplorerSnapshot; result: ExplorerUploadResult } {
  const source = editSnapshot(snapshot);
  assertDestination(source.entries, parent);
  const options = resolveUploadOptions(upload);
  const prepared = files.map((file, fileIndex) => {
    if (
      !file ||
      typeof file.name !== "string" ||
      !Number.isSafeInteger(file.size) || file.size < 0 ||
      typeof file.arrayBuffer !== "function" ||
      (file.webkitRelativePath !== undefined && typeof file.webkitRelativePath !== "string")
    ) {
      throw new Error("ファイルを選択してください");
    }
    const parts = (file.webkitRelativePath || file.name).split("/").map(normalizeEntryName);
    return { file, fileIndex, parts, name: parts[parts.length - 1], relativePath: parts.join("/") };
  });
  const state = uploadSessionState(session, parent, prepared);
  if (!Array.isArray(decisions)) throw new Error("アップロードの確認結果を配列で指定してください");
  const decisionsByIndex = new Map<number, ExplorerUploadDecision>();
  for (const decision of decisions) {
    if (!decision || typeof decision !== "object" ||
      !Number.isSafeInteger(decision.fileIndex) || decision.fileIndex < 0 || decision.fileIndex >= files.length ||
      decisionsByIndex.has(decision.fileIndex) ||
      (decision.action !== "overwrite" && decision.action !== "skip") ||
      !decision.existing || typeof decision.existing !== "object")
      throw new Error("アップロードの確認結果が正しくありません");
    decisionsByIndex.set(decision.fileIndex, decision);
  }
  const { accepted, rejections } = validateUploadFiles(prepared, options);
  let addedCount = 0;
  let overwrittenCount = 0;
  let skippedCount = 0;
  const result = (): ExplorerUploadResult => ({
    attemptedCount: files.length, addedCount, overwrittenCount, skippedCount, rejections,
  });
  if (!accepted.length) return { snapshot, result: result() };
  const entries = [...source.entries];
  const positions = new Map(entries.map((entry, index) => [entry.id, index]));
  const allocateId = (key: string) => {
    let id = state.allocations.get(key);
    if (!id || positions.has(id)) {
      id = crypto.randomUUID();
      state.allocations.set(key, id);
    }
    return id;
  };
  const insert = (entry: ExplorerEntry) => {
    positions.set(entry.id, entries.length);
    entries.push(entry);
  };
  const names = new Map<string, Map<string, ExplorerEntry>>();
  for (const entry of entries) {
    const siblings = names.get(entry.parent) ?? new Map<string, ExplorerEntry>();
    siblings.set(nameKey(entry.name), entry);
    names.set(entry.parent, siblings);
  }
  const namesAt = (id: string) => {
    const siblings = names.get(id) ?? new Map<string, ExplorerEntry>();
    names.set(id, siblings);
    return siblings;
  };
  const now = state.now;
  let changed = false;
  let conflictCount = 0;
  let firstConflictIndex = 0;
  const unresolved: ExplorerUploadConflict[] = [];
  for (const { file, fileIndex, parts, relativePath } of accepted) {
    let destination = parent;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const part = parts[depth];
      const existing = namesAt(destination).get(nameKey(part));
      if (existing) {
        if (existing.kind !== "folder")
          throw new Error(`「${part}」と同じ名前のファイルがすでにあります`);
        destination = existing.id;
      } else {
        const folder = newFolder(destination, part, now, allocateId(`folder:${JSON.stringify(parts.slice(0, depth + 1).map(nameKey))}`));
        insert(folder);
        namesAt(destination).set(nameKey(folder.name), folder);
        destination = folder.id;
        changed = true;
      }
    }
    const name = parts[parts.length - 1];
    const existing = namesAt(destination).get(nameKey(name));
    if (existing) {
      if (existing.kind !== "file") throw new Error(`「${relativePath}」と同じ名前のフォルダがすでにあります`);
      conflictCount++;
      const decision = decisionsByIndex.get(fileIndex);
      if (!decision || !matchesUploadDecision(existing, decision.existing)) {
        firstConflictIndex ||= conflictCount;
        unresolved.push({ fileIndex, relativePath, file, existing });
        // Treat unanswered conflicts as skips while counting and validating the
        // rest. The entire candidate remains private until every conflict is resolved.
        continue;
      }
      if (decision.action === "skip") {
        skippedCount++;
        continue;
      }
      const overwritten: ExplorerEntry = {
        ...existing, size: file.size, mime: file.type || "application/octet-stream", source: { kind: "local", file },
      };
      if (!equalEntry(existing, overwritten)) {
        entries[positions.get(existing.id)!] = overwritten;
        namesAt(destination).set(nameKey(existing.name), overwritten);
        changed = true;
      }
      overwrittenCount++;
      continue;
    }
    const added: ExplorerEntry = {
      id: allocateId(`file:${fileIndex}`),
      parent: destination,
      name,
      extension: entryExtension({ name, kind: "file" }),
      kind: "file",
      size: file.size,
      mime: file.type || "application/octet-stream",
      createdAt: now,
      updatedAt: now,
      favorite: 0,
      source: { kind: "local", file },
    };
    insert(added);
    namesAt(destination).set(nameKey(name), added);
    addedCount++;
    changed = true;
  }
  if (unresolved.length)
    throw new ExplorerUploadConflictError(unresolved[0], session, firstConflictIndex, conflictCount, unresolved);
  return { snapshot: changed ? finishEdit(source, entries) : snapshot, result: result() };
}

function equalEntry(left: ExplorerEntry, right: ExplorerEntry): boolean {
  const leftSource = left.source;
  const rightSource = right.source;
  const sameSource =
    leftSource === rightSource ||
    (leftSource?.kind === "existing" &&
      rightSource?.kind === "existing" &&
      leftSource.id === rightSource.id) ||
    (leftSource?.kind === "local" &&
      rightSource?.kind === "local" &&
      leftSource.file === rightSource.file);
  // Timestamps alone do not leave a draft dirty after an operation is reversed.
  return (
    left.id === right.id &&
    left.parent === right.parent &&
    left.name === right.name &&
    left.kind === right.kind &&
    left.size === right.size &&
    left.mime === right.mime &&
    left.favorite === right.favorite &&
    sameSource
  );
}

type SnapshotChanges = ExplorerSavePayload["changes"];
const snapshotChanges = new WeakMap<ExplorerSnapshot, WeakMap<ExplorerSnapshot, SnapshotChanges>>();
function compareSnapshots(baseline: ExplorerSnapshot, draft: ExplorerSnapshot) {
  const cached = snapshotChanges.get(baseline)?.get(draft);
  if (cached) return cached;
  const original = getEntryIndex(baseline.entries).byId;
  const current = getEntryIndex(draft.entries).byId;
  const changes = {
    created: draft.entries.filter((entry) => !original.has(entry.id)),
    updated: draft.entries.filter((entry) => {
      const previous = original.get(entry.id);
      return previous !== undefined && previous !== entry && !equalEntry(previous, entry);
    }),
    deleted: baseline.entries.filter((entry) => !current.has(entry.id)),
  };
  if (immutableSnapshots.has(baseline) && immutableSnapshots.has(draft)) {
    const drafts = snapshotChanges.get(baseline) ?? new WeakMap<ExplorerSnapshot, SnapshotChanges>();
    drafts.set(draft, changes);
    snapshotChanges.set(baseline, drafts);
  }
  return changes;
}

/** The host receives the final tree plus net changes, never a storage operation log. */
export function getSavePayload(
  baseline: ExplorerSnapshot,
  draft: ExplorerSnapshot,
): ExplorerSavePayload {
  const changes = compareSnapshots(baseline, draft);
  return {
    entries: draft.entries.map(cloneEntry),
    changes: {
      created: changes.created.map(cloneEntry),
      updated: changes.updated.map(cloneEntry),
      deleted: changes.deleted.map(cloneEntry),
    },
  };
}

export function hasChanges(
  baseline: ExplorerSnapshot,
  draft: ExplorerSnapshot,
): boolean {
  if (baseline === draft) return false;
  const { created, updated, deleted } = compareSnapshots(baseline, draft);
  return created.length > 0 || updated.length > 0 || deleted.length > 0;
}
