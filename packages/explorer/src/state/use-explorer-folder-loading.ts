"use client";

import { useCallback, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerEntry, ExplorerSnapshot } from "../model/draft";
import { getEntryIndex } from "../model/entry-index";
import { formatExplorerPath } from "../model/path";
import { assertExplorerFoldersLoaded, initialExplorerLoadedFolders, mergeExplorerFolderEntries,
  type ExplorerFolderLoadHandler, type ExplorerFolderLoadingOptions, type ExplorerFolderLoadOptions,
  type ExplorerFolderLoadState, type ExplorerFolderLoadEvent } from "../model/folder-loading";
import type { ExplorerEntryPermissionCheck } from "../model/entry-permissions";

type Snapshots = { baseline: ExplorerSnapshot; draft: ExplorerSnapshot };
type Options = {
  handler?: ExplorerFolderLoadHandler;
  options?: ExplorerFolderLoadingOptions;
  getSnapshots(): Snapshots;
  hydrate(snapshots: Snapshots): void;
  canLoad(): boolean;
  emit(event: ExplorerFolderLoadEvent): void;
};
type Lease = { finish(value: boolean): void };
type Request = { controller: AbortController; leases: Set<Lease>; epoch: number };
const UNLOADED: ExplorerFolderLoadState = Object.freeze({ status: "unloaded", error: null });
const LOADED: ExplorerFolderLoadState = Object.freeze({ status: "loaded", error: null });
const LOADING: ExplorerFolderLoadState = Object.freeze({ status: "loading", error: null });

/** One request per folder, shared by independently cancellable consumers. */
export function useExplorerFolderLoading(input: Options) {
  const hasHandler = typeof input.handler === "function";
  const [enabled, setEnabled] = useState(hasHandler);
  // Enabling partial loading is a one-way mode transition for this workspace.
  if (hasHandler && !enabled) setEnabled(true);
  const policy = useRef(input);
  const lazy = useRef(hasHandler);
  const loaded = useRef<Set<string> | null>(null);
  if (loaded.current === null) loaded.current = initialExplorerLoadedFolders(input.getSnapshots().baseline.entries, input.options?.initialLoadedFolderIds);
  const states = useRef(new Map<string, ExplorerFolderLoadState>());
  const pending = useRef(new Map<string, Request>());
  const epoch = useRef(0), active = useRef(true), cancelling = useRef(false);
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => { if (active.current) setRevision(value => value + 1); }, []);
  useInsertionEffect(() => { policy.current = input; if (input.handler) lazy.current = true; });
  const isLoaded = useCallback((id: string) => {
    if (!lazy.current) return true;
    const { baseline, draft } = policy.current.getSnapshots();
    if (id !== "root" && getEntryIndex(draft.entries).byId.get(id)?.kind !== "folder") return false;
    return loaded.current!.has(id) || id !== "root" && !getEntryIndex(baseline.entries).byId.has(id);
  }, []);
  const getFolderLoadState = useCallback((id: string): ExplorerFolderLoadState => isLoaded(id) ? LOADED : states.current.get(id) ?? UNLOADED, [isLoaded]);
  const cancelAll = useCallback(() => {
    epoch.current++;
    const tasks = [...pending.current.entries()]; pending.current.clear();
    cancelling.current = true;
    try {
      for (const [id, request] of tasks) {
        states.current.delete(id);
        for (const lease of [...request.leases]) lease.finish(false);
        request.controller.abort();
      }
    } finally { cancelling.current = false; }
    if (tasks.length) changed();
  }, [changed]);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; cancelAll(); };
  }, [cancelAll]);
  useLayoutEffect(() => { if (!hasHandler) cancelAll(); }, [hasHandler, cancelAll]);

  const loadOne = useCallback((id: string, signal?: AbortSignal): Promise<boolean> => {
    if (!active.current || cancelling.current || signal?.aborted || !policy.current.canLoad()) return Promise.resolve(false);
    const snapshots = policy.current.getSnapshots();
    if (id !== "root" && getEntryIndex(snapshots.draft.entries).byId.get(id)?.kind !== "folder") return Promise.resolve(false);
    if (isLoaded(id)) return Promise.resolve(true);
    const handler = policy.current.handler;
    const path = formatExplorerPath(snapshots.draft.entries, id);
    if (!handler) {
      const message = "フォルダの読み込み機能を利用できません";
      states.current.set(id, Object.freeze({ status: "error", error: message })); changed();
      policy.current.emit({ type: "folder-load", status: "error", folderId: id, path, message });
      return Promise.resolve(false);
    }
    let request = pending.current.get(id);
    const start = !request;
    if (!request) {
      request = { controller: new AbortController(), leases: new Set(), epoch: epoch.current };
      pending.current.set(id, request); states.current.set(id, LOADING);
    }
    const task = request;
    const promise = new Promise<boolean>(resolve => {
      let finished = false;
      const lease: Lease = { finish(value) {
        if (finished) return; finished = true;
        signal?.removeEventListener("abort", abort); task.leases.delete(lease); resolve(value);
      } };
      const abort = () => {
        lease.finish(false);
        if (!task.leases.size && pending.current.get(id) === task) {
          pending.current.delete(id); states.current.delete(id); task.controller.abort(); changed();
        }
      };
      task.leases.add(lease);
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (start) {
      changed();
      // Let StrictMode's replay cancel the first lease before issuing host I/O.
      void Promise.resolve().then(async () => {
        const current = () => active.current && !task.controller.signal.aborted && pending.current.get(id) === task
          && task.epoch === epoch.current && policy.current.canLoad();
        try {
          if (!current()) return;
          policy.current.emit({ type: "folder-load", status: "start", folderId: id, path });
          if (!current()) return;
          const response = await handler({ folderId: id, path }, { signal: task.controller.signal });
          if (!current()) return;
          const latest = policy.current.getSnapshots();
          const merged = mergeExplorerFolderEntries(latest.baseline, latest.draft, id, response);
          if (!current()) return;
          policy.current.hydrate(merged);
          loaded.current!.add(id); states.current.delete(id); pending.current.delete(id); changed();
          for (const lease of [...task.leases]) lease.finish(true);
          policy.current.emit({ type: "folder-load", status: "success", folderId: id, path, addedCount: merged.addedCount });
        } catch (error) {
          if (!current()) return;
          const message = error instanceof Error && error.message ? error.message : "フォルダを取得できませんでした";
          states.current.set(id, Object.freeze({ status: "error", error: message })); pending.current.delete(id); changed();
          for (const lease of [...task.leases]) lease.finish(false);
          policy.current.emit({ type: "folder-load", status: "error", folderId: id, path, message });
        } finally {
          // A host callback can synchronously make loading unavailable. Settle
          // this task too, without disturbing a replacement request for this ID.
          if (pending.current.get(id) === task) {
            pending.current.delete(id); states.current.delete(id);
            for (const lease of [...task.leases]) lease.finish(false);
            task.controller.abort(); changed();
          }
        }
      });
    }
    return promise;
  }, [changed, isLoaded]);

  const loadFolder = useCallback(async (id: string, options: ExplorerFolderLoadOptions = {}): Promise<boolean> => {
    if (typeof id !== "string" || options.recursive !== undefined && typeof options.recursive !== "boolean") return false;
    const started = epoch.current, queue = [id], visited = new Set<string>();
    while (queue.length) {
      if (options.signal?.aborted || started !== epoch.current) return false;
      const folder = queue.pop()!;
      if (visited.has(folder)) continue; visited.add(folder);
      if (!await loadOne(folder, options.signal) || options.signal?.aborted || started !== epoch.current) return false;
      if (options.recursive) for (const child of getEntryIndex(policy.current.getSnapshots().draft.entries).folderChildrenByParent.get(folder) ?? []) queue.push(child.id);
    }
    return true;
  }, [loadOne]);
  const getLoadedFolderIds = useCallback((): readonly string[] => {
    const { draft } = policy.current.getSnapshots();
    return Object.freeze(["root", ...draft.entries.filter(entry => entry.kind === "folder").map(entry => entry.id)].filter(isLoaded).sort());
  }, [isLoaded]);
  const replaceBaseline = useCallback((entries: readonly ExplorerEntry[], keepLoaded?: readonly string[]) => {
    cancelAll(); states.current.clear();
    const folders = new Set(["root", ...entries.filter(entry => entry.kind === "folder").map(entry => entry.id)]);
    loaded.current = keepLoaded ? new Set(keepLoaded.filter(id => folders.has(id))) : folders;
    changed();
  }, [cancelAll, changed]);
  const assertLoadedForChecks = useCallback((checks: readonly ExplorerEntryPermissionCheck[]) => {
    if (lazy.current) assertExplorerFoldersLoaded(policy.current.getSnapshots().draft.entries, checks, isLoaded);
  }, [isLoaded]);
  return { loadFolder, getFolderLoadState, folderLoadRevision: revision, folderLoadingEnabled: enabled || hasHandler,
    assertLoadedForChecks, cancelAll, replaceBaseline, getLoadedFolderIds };
}
