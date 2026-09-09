import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { getEntryPath } from "./entries";
import { DEFAULT_ROOT_LABEL, resolveExplorerPath } from "./path";

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
