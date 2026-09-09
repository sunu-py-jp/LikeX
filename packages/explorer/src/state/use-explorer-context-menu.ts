"use client";

import { useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import { createContextMenuExecutor, resolveContextMenuItems, type ContextMenuExecutionMode, type ContextMenuExecutionState } from "../core";
import type { ExplorerContextMenuChange, ExplorerContextMenuContext, ExplorerContextMenuItem, ExplorerContextMenuProvider } from "../model/context-menu";
import { validateExplorerContextMenuTarget } from "../model/context-menu";
import { describeEntries, describeEntry } from "../model/item-info";
import { readEntryFile } from "../model/file-content";
import type { ExplorerFileReader } from "../model/file-content";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerLocationInfo, ExplorerViewEvent } from "../model/events";
import type { ResolvedExplorerOptions } from "../model/config";
import type { ExplorerWorkspace } from "./use-explorer-workspace";
import type { useExplorerUpload } from "./use-explorer-upload";
import type { ExplorerEditIntent } from "../model/edit-session";

type Options = {
  workspace: ExplorerWorkspace;
  options: ResolvedExplorerOptions;
  provider?: ExplorerContextMenuProvider;
  mode?: ContextMenuExecutionMode;
  readFile?: ExplorerFileReader;
  windowId: string;
  ownerDocument: Document | null;
  tabId: string;
  selected: readonly string[];
  location: ExplorerLocationInfo;
  container: { current: HTMLElement | null };
  upload: ReturnType<typeof useExplorerUpload>;
  notify: (kind: "success" | "error" | "info", message: string) => unknown;
  emitEvent: (event: ExplorerViewEvent) => void;
};

export type ExplorerCustomMenu = { context: ExplorerContextMenuContext; items: readonly ExplorerContextMenuItem[] };

function cloneChange(change: ExplorerContextMenuChange): ExplorerContextMenuChange {
  if (change?.type === "upload") return Object.freeze({ ...change, files: Object.freeze([...change.files]) });
  if (change?.type === "action") return Object.freeze({ type: "action", action: Object.freeze({
    ...change.action, ...(change.action.ids ? { ids: Object.freeze([...change.action.ids]) as unknown as string[] } : {}),
  }) });
  throw new Error("メニューの処理結果が正しくありません");
}

/** One view prepares a plan; the shared draft owns the workspace-wide write lock. */
export function useExplorerContextMenu(options: Options) {
  const current = useRef(options);
  useInsertionEffect(() => { current.current = options; }, [options]);
  const mounted = useRef(true);
  const cancelCurrent = useRef<() => void>(() => {});
  const [owner] = useState(() => Symbol("explorer-context-menu"));
  const [state, setState] = useState<ContextMenuExecutionState>({
    phase: "idle", mode: "block", requestId: null, itemId: null,
    label: "", description: "", error: null, blocksChanges: false,
  });
  // The headless factory stores callbacks; it never invokes them during render.
  // eslint-disable-next-line react-hooks/refs
  const [executor] = useState(() => createContextMenuExecutor<ExplorerContextMenuContext, ExplorerContextMenuChange>({
    getRevision: () => current.current.workspace.draft.getEntries(),
    canRun: () => mounted.current && current.current.options.ui.contextMenu,
    prepareChange: cloneChange,
    validateTarget: (context, change) => validateExplorerContextMenuTarget(context, change, current.current.workspace.draft.getEntries()),
    apply: async (change, context, operation, guard) => {
      const active = () => mounted.current && guard.isCurrent() && !operation.signal.aborted;
      const check = () => {
        if (!active()) throw new Error("処理中にデータが変更されたため、結果を反映できません。再実行してください");
        const latest = current.current;
        if (!latest.options.ui.contextMenu || latest.options.readOnly) throw new Error("読み取り専用のため変更できません");
        if (change.type === "upload") {
          const hasFolders = change.files.some(file => !!file.webkitRelativePath);
          const hasFiles = !hasFolders || change.files.some(file => !file.webkitRelativePath);
          if ((hasFolders && !latest.options.features.uploadFolders) || (hasFiles && !latest.options.features.uploadFiles))
            throw new Error("このアップロード操作は無効になっています");
        }
        const feature = change.type === "upload" ? null : change.action.action === "create" ? "createFolder"
            : change.action.action === "favorite" ? "favorites" : change.action.action;
        if (feature && !latest.options.features[feature]) throw new Error("この操作は無効になっています");
        validateExplorerContextMenuTarget(context, change, latest.workspace.draft.getEntries());
        return latest;
      };
      const runEdit = async (intent: ExplorerEditIntent, commit: () => boolean, onError: (error: unknown) => void) => {
        try {
          const latest = check();
          const draft = latest.workspace.draft;
          const abort = () => draft.cancelEditRequest(context.windowId);
          operation.signal.addEventListener("abort", abort, { once: true });
          let allowed: boolean;
          try { allowed = await draft.requestEdit({ ...intent, windowId: context.windowId }, owner); }
          finally { operation.signal.removeEventListener("abort", abort); }
          if (!allowed) throw new Error(draft.getEditState().error ?? "編集が許可されませんでした");
          check();
          return commit();
        } catch (error) { onError(error); return false; }
      };
      const latest = check();
      if (change.type === "upload") {
        await latest.upload.startAsync(change.files, change.parentId,
          change.files.some(file => !!file.webkitRelativePath), { owner, signal: operation.signal, runEdit, onCancel: () => cancelCurrent.current() });
      } else {
        const commit = latest.workspace.draft.prepareAction(change.action, owner);
        if (!commit) return;
        let failure: unknown;
        const changed = await runEdit(change.action, commit, error => { failure = error; });
        if (failure) throw failure;
        if (!changed && active()) throw new Error("変更は行われませんでした");
      }
    },
    onStateChange: next => {
      const draft = current.current.workspace.draft;
      if (next.phase === "idle") draft.endContextMenuOperation(owner);
      else draft.setContextMenuBlocking(owner, next.blocksChanges);
      if (mounted.current) setState(next);
    },
    onEvent: event => {
      current.current.emitEvent(event);
      if (event.status === "error") current.current.notify("error", event.message ?? "メニューの処理に失敗しました");
      else if (event.status === "success") current.current.notify("success", "処理が完了しました");
    },
  }));
  useInsertionEffect(() => { cancelCurrent.current = () => executor.cancel(); }, [executor]);
  const enabled = !!options.provider;
  useLayoutEffect(() => {
    mounted.current = true;
    const cancel = () => executor.cancel();
    const view = options.ownerDocument?.defaultView;
    if (enabled) view?.addEventListener?.("pagehide", cancel);
    return () => {
      executor.cancel();
      mounted.current = false;
      current.current.workspace.draft.endContextMenuOperation(owner);
      if (enabled) view?.removeEventListener?.("pagehide", cancel);
    };
  }, [executor, options.ownerDocument, owner, enabled]);
  const editRevision = options.workspace.draft.editRevision;
  useLayoutEffect(() => { executor.cancel(); }, [executor, editRevision, options.options.ui.contextMenu, options.options.readOnly]);

  function getMenu(entry?: ExplorerEntry): ExplorerCustomMenu | null {
    const latest = current.current;
    if (!latest.provider || !latest.options.ui.contextMenu) return null;
    const entries = latest.workspace.draft.getEntries();
    const target = entry ? entries.find(item => item.id === entry.id) : undefined;
    if (entry && !target) return null;
    const selectedIds = target && !latest.selected.includes(target.id) ? [target.id] : target ? latest.selected : [];
    const reader = latest.readFile;
    const freezeInfo = (item: ExplorerEntry) => {
      const info = describeEntry(entries, item);
      if (info.source) Object.freeze(info.source);
      return Object.freeze(info);
    };
    const context: ExplorerContextMenuContext = Object.freeze({
      target: Object.freeze(target ? { kind: "entry" as const, entry: freezeInfo(target) }
        : { kind: "background" as const, parentId: latest.location.kind === "folder" ? latest.location.id : null }),
      selectedEntries: Object.freeze(entries.filter(item => selectedIds.includes(item.id)).map(freezeInfo)),
      location: Object.freeze({ ...latest.location }), tabId: latest.tabId, windowId: latest.windowId,
      readOnly: latest.options.readOnly, features: Object.freeze({ ...latest.options.features }),
      container: latest.container.current,
      getEntries: () => describeEntries(entries),
      readFile: async (id: string) => {
        const item = entries.find(item => item.id === id);
        if (!item) throw new Error("ファイルが見つかりません");
        return readEntryFile(item, reader);
      },
    });
    try {
      const items = resolveContextMenuItems(latest.provider, context);
      return { context, items };
    } catch (error) {
      latest.notify("error", error instanceof Error ? error.message : "右クリックメニューを表示できませんでした");
      return null;
    }
  }
  async function run(menu: ExplorerCustomMenu, item: ExplorerContextMenuItem) {
    const latest = current.current;
    if (!mounted.current || item.disabled || !latest.options.ui.contextMenu ||
      !latest.workspace.draft.beginContextMenuOperation(owner, (latest.mode ?? "block") === "block")) return;
    try {
      await executor.run(item, menu.context, latest.mode ?? "block");
    } finally {
      if (executor.getState().phase === "idle") latest.workspace.draft.endContextMenuOperation(owner);
    }
  }
  return { state, getMenu, run, confirm: () => executor.confirm(), cancel: () => executor.cancel() };
}
