"use client";

import { useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ResolvedExplorerOptions } from "../model/config";
import { resolveExplorerFileTargets, resolveExplorerNavigation,
  type ExplorerFileTarget, type ExplorerNavigationErrorCode, type ExplorerNavigationHandle,
  type ExplorerNavigationResult, type ExplorerShowFileOptions } from "../model/navigation";
import type { ExplorerWorkspace } from "./use-explorer-workspace";
import { explorerLocationPatch } from "./navigation-state";

export type ExplorerRevealRequest = Readonly<{ id: string; tabId: string }>;

/** Commands operate on the currently committed draft and the main pane's active tab. */
export function useExplorerNavigation({ workspace, windowId, options, prepare, preview }: {
  workspace: ExplorerWorkspace;
  windowId: string;
  options: ResolvedExplorerOptions;
  prepare: () => void;
  preview: (entry: ExplorerEntry) => void;
}) {
  const [revealRequest, setRevealRequest] = useState<ExplorerRevealRequest | null>(null);
  const commandRevision = useRef(0);
  const fail = (code: ExplorerNavigationErrorCode, message: string): ExplorerNavigationResult => ({ ok: false, code, message });
  function apply(location: string | null, expanded: readonly string[], fileIds: readonly string[]) {
    const revision = ++commandRevision.current;
    const pane = workspace.tabs.forWindow(windowId);
    if (location === null) {
      pane.patchTabState({ selectedIds: [], anchor: null });
      setRevealRequest(null);
      return true;
    }
    // An explicit host request supersedes a still-pending initial preview.
    workspace.takeInitialPreview(pane.activeTabId);
    prepare();
    // Cancelling an edit request can synchronously notify the host, which may
    // issue a newer command. The newest accepted command owns the view.
    if (revision !== commandRevision.current) return false;
    pane.patchTabState(previous => explorerLocationPatch(previous, location, expanded, fileIds));
    setRevealRequest(fileIds.length ? { id: fileIds[0], tabId: pane.activeTabId } : null);
    return true;
  }
  function files(targets: readonly ExplorerFileTarget[], showOptions?: ExplorerShowFileOptions): ExplorerNavigationResult {
    const mode = showOptions?.mode ?? "select";
    if (mode !== "select" && mode !== "preview") return fail("invalid-mode", "選択またはプレビューを指定してください");
    const entries = workspace.draft.getEntries();
    const resolved = resolveExplorerFileTargets(entries, targets);
    if (!resolved.ok) return resolved;
    if (resolved.value.fileIds.length && options.selection.mode === "none")
      return fail("selection-disabled", "ファイルの選択が無効になっています");
    if (resolved.value.fileIds.length > 1 && options.selection.mode === "single")
      return fail("selection-limit", "複数のファイルは選択できません");
    if (mode === "preview" && !options.features.preview)
      return fail("preview-disabled", "プレビューが無効になっています");
    const { location, expanded, fileIds } = resolved.value;
    if (!apply(location, expanded, fileIds)) return { ok: true };
    if (mode === "preview") {
      const entry = entries.find(item => item.id === fileIds[0]);
      if (entry) preview(entry);
    }
    return { ok: true };
  }
  const handlers: ExplorerNavigationHandle = {
    navigate(path) {
      const resolved = resolveExplorerNavigation(workspace.draft.getEntries(), path);
      if (!resolved.ok) return resolved;
      apply(resolved.value.location, resolved.value.expanded, []);
      return { ok: true };
    },
    selectFiles: targets => files(targets),
    showFile: (target, showOptions) => files([target], showOptions),
  };
  const committed = useRef(handlers);
  useInsertionEffect(() => { committed.current = handlers; });
  useLayoutEffect(() => {
    if (windowId !== "main") return;
    return workspace.navigation.register({
      navigate: path => committed.current.navigate(path),
      selectFiles: targets => committed.current.selectFiles(targets),
      showFile: (target, showOptions) => committed.current.showFile(target, showOptions),
    });
  }, [workspace.navigation, windowId]);
  return { revealRequest, cancelReveal: () => setRevealRequest(null) };
}
