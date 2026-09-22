"use client";

import { useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ResolvedExplorerOptions } from "../model/config";
import { resolveExplorerFileTargets, resolveExplorerEntryTargets, resolveExplorerNavigation,
  type ExplorerFileTarget, type ExplorerNavigationErrorCode, type ExplorerNavigationHandle,
  type ExplorerNavigationResult, type ExplorerShowFileOptions } from "../model/navigation";
import type { ExplorerWorkspace } from "./use-explorer-workspace";
import { explorerLocationPatch } from "./navigation-state";

export type ExplorerRevealRequest = Readonly<{ id: string; tabId: string }>;

/** Commands operate on the currently committed draft and the main pane's active tab. */
export function useExplorerNavigation({ workspace, windowId, options, prepare, preview, onPermissionError, visibleIds }: {
  workspace: ExplorerWorkspace;
  windowId: string;
  options: ResolvedExplorerOptions;
  prepare: () => void;
  preview: (entry: ExplorerEntry) => void;
  onPermissionError?: (message: string) => void;
  visibleIds: readonly string[];
}) {
  const [revealRequest, setRevealRequest] = useState<ExplorerRevealRequest | null>(null);
  const commandRevision = useRef(0);
  const renderedTab = workspace.tabs.forWindow(windowId).activeTab;
  const renderedEntries = workspace.draft.entries;
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
    if (resolved.value.fileIds.length && options.selection.mode === "none" && mode !== "preview")
      return fail("selection-disabled", "ファイルの選択が無効になっています");
    if (resolved.value.fileIds.length > 1 && options.selection.mode === "single")
      return fail("selection-limit", "複数のファイルは選択できません");
    if (mode === "preview" && !options.features.preview)
      return fail("preview-disabled", "プレビューが無効になっています");
    const { location, expanded, fileIds } = resolved.value;
    if (mode === "preview") {
      try { workspace.draft.assertEntryPermissions(fileIds.map(id => ({ id, operation: "preview" }))); }
      catch (error) {
        const message = error instanceof Error ? error.message : "プレビューが許可されていません";
        onPermissionError?.(message);
        return fail("permission-denied", message);
      }
    }
    if (!apply(location, expanded, options.selection.mode === "none" ? [] : fileIds)) return { ok: true };
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
    selectEntries(targets) {
      const entries = workspace.draft.getEntries();
      const resolved = resolveExplorerEntryTargets(entries, targets);
      if (!resolved.ok) return resolved;
      const ids = resolved.value.entryIds;
      if (ids.length && options.selection.mode === "none") return fail("selection-disabled", "項目の選択が無効になっています");
      if (ids.length > 1 && options.selection.mode === "single") return fail("selection-limit", "複数の項目は選択できません");
      if (!ids.length) { apply(null, [], []); return { ok: true }; }
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const parent = byId.get(ids[0])!.parent;
      const pane = workspace.tabs.forWindow(windowId);
      // Preserve the current search/favorites view when it already contains
      // every requested item, including results from different folders.
      const visible = new Set(visibleIds);
      const sameListing = pane.activeTab.id === renderedTab.id && pane.activeTab.query === renderedTab.query &&
        pane.activeTab.requestedLocation === renderedTab.requestedLocation && entries === renderedEntries;
      if (sameListing && ids.every(id => visible.has(id))) {
        commandRevision.current++;
        pane.patchTabState({ selectedIds: [...ids], anchor: ids[0] });
        setRevealRequest({ id: ids[0], tabId: pane.activeTabId });
        return { ok: true };
      }
      if (ids.some(id => byId.get(id)!.parent !== parent))
        return fail("not-visible", "異なるフォルダの項目は、すべて現在の一覧に表示されている場合に選択できます");
      const ancestors: string[] = ["root"];
      for (let entry = byId.get(parent); entry; entry = byId.get(entry.parent)) ancestors.push(entry.id);
      apply(parent, ancestors, ids);
      return { ok: true };
    },
    showFile: (target, showOptions) => files([target], showOptions),
    previewFile: target => files([target], { mode: "preview" }),
  };
  const committed = useRef(handlers);
  useInsertionEffect(() => { committed.current = handlers; });
  useLayoutEffect(() => {
    if (windowId !== "main") return;
    return workspace.navigation.register({
      navigate: path => committed.current.navigate(path),
      selectFiles: targets => committed.current.selectFiles(targets),
      selectEntries: targets => committed.current.selectEntries(targets),
      showFile: (target, showOptions) => committed.current.showFile(target, showOptions),
      previewFile: target => committed.current.previewFile(target),
    });
  }, [workspace.navigation, windowId]);
  return { revealRequest, cancelReveal: () => setRevealRequest(null) };
}
