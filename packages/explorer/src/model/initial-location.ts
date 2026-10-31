import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { getEntryPath } from "./entries";
import { DEFAULT_ROOT_LABEL, resolveExplorerPath } from "./path";
import { matchesExplorerSelectionKind, type ExplorerSelectionOptions } from "./config";
import { resolveExplorerEntryTargets } from "./navigation";

type LocationEntry = Pick<ExplorerEntry, "id" | "parent" | "name" | "kind">;

type InitialLocationOptions = {
  initialEntries: readonly LocationEntry[];
  initialPath?: string;
  defaultPath?: string;
  rootLabel?: string;
  selectedFile?: string;
};

export type InitialExplorerLocation = {
  location: string;
  expanded: string[];
  error: string | null;
  selectedFileId: string | null;
};

/** Resolve the first tab's folder and optional file without changing the draft. */
export function resolveInitialExplorerLocation({
  initialEntries, initialPath, defaultPath, rootLabel, selectedFile,
}: InitialLocationOptions): InitialExplorerLocation {
  const entry = selectedFile === undefined ? undefined : getEntryIndex(initialEntries).byId.get(selectedFile);
  const file = entry?.kind === "file" ? entry : undefined;
  const selectionError = selectedFile === undefined || file ? null : entry
    ? `「${entry.name}」はフォルダです。選択するファイルのIDを指定してください`
    : "選択するファイルが見つかりません。ファイルのIDを確認してください";
  const label = rootLabel?.trim() || DEFAULT_ROOT_LABEL;

  try {
    const location = initialPath !== undefined
      ? resolveExplorerPath(initialEntries, initialPath.trim() || "/", "root", label)
      : file
        ? resolveExplorerPath(initialEntries, ".", file.parent, label)
        : resolveExplorerPath(initialEntries, defaultPath?.trim() || "/", "root", label);
    const error = selectionError ?? (file && file.parent !== location
      ? `選択するファイル「${file.name}」は、指定された初期フォルダにありません`
      : null);
    return {
      location,
      expanded: ["root", ...getEntryPath(initialEntries, location).map(ancestor => ancestor.id)],
      error,
      selectedFileId: error ? null : file?.id ?? null,
    };
  } catch (error) {
    return {
      location: "root",
      expanded: ["root"],
      error: error instanceof Error ? error.message : "フォルダのパスを確認してください",
      selectedFileId: null,
    };
  }
}

type InitialSelectionOptions = Omit<InitialLocationOptions, "selectedFile"> & {
  initialSelectedIds: readonly string[];
  selection?: ExplorerSelectionOptions;
};

export type InitialExplorerSelection = Omit<InitialExplorerLocation, "selectedFileId"> & {
  selectedIds: string[];
};

/** Resolve a cached, same-folder initial selection atomically, before the first render. */
export function resolveInitialExplorerSelection({
  initialEntries, initialPath, defaultPath, rootLabel, initialSelectedIds, selection,
}: InitialSelectionOptions): InitialExplorerSelection {
  const common = { initialEntries, initialPath, defaultPath, rootLabel };
  function fallback(error: string | null): InitialExplorerSelection {
    const location = resolveInitialExplorerLocation(common);
    return { location: location.location, expanded: location.expanded, error: location.error ?? error, selectedIds: [] };
  }
  if (!Array.isArray(initialSelectedIds)) return fallback("初期選択する項目のIDを配列で指定してください");
  const targets: { id: string }[] = [];
  for (let index = 0; index < initialSelectedIds.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(initialSelectedIds, index);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !descriptor.value)
      return fallback("初期選択する項目のIDを空でない文字列で指定してください");
    targets.push({ id: descriptor.value });
  }
  if (!targets.length) return fallback(null);
  const resolved = resolveExplorerEntryTargets(initialEntries, targets);
  if (!resolved.ok) return fallback(resolved.message);
  const ids = resolved.value.entryIds;
  if (selection?.mode === "none") return fallback("項目の選択が無効になっています");
  if (selection?.mode === "single" && ids.length > 1) return fallback("複数の項目は選択できません");
  const byId = getEntryIndex(initialEntries).byId;
  const entries = ids.map(id => byId.get(id)!);
  if (entries.some(entry => !matchesExplorerSelectionKind(entry, selection?.kind)))
    return fallback(selection?.kind === "file" ? "選択できる項目はファイルだけです" : "選択できる項目はフォルダだけです");
  const parent = entries[0].parent;
  if (entries.some(entry => entry.parent !== parent))
    return fallback("初期選択する項目は、同じフォルダ内で指定してください");
  if (initialPath !== undefined) {
    const location = resolveInitialExplorerLocation(common);
    if (location.error) return { location: location.location, expanded: location.expanded, error: location.error, selectedIds: [] };
    if (location.location !== parent) return { location: location.location, expanded: location.expanded,
      error: "初期選択する項目は、指定された初期フォルダにありません", selectedIds: [] };
    return { location: location.location, expanded: location.expanded, error: null, selectedIds: [...ids] };
  }
  return { location: parent, expanded: ["root", ...getEntryPath(initialEntries, parent).map(entry => entry.id)],
    error: null, selectedIds: [...ids] };
}
