"use client";

import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type SetStateAction } from "react";
import type { ExplorerLocation } from "./view-state";
import type { ExplorerViewMode } from "../model/config";

export type TabViewState = {
  requestedLocation: ExplorerLocation;
  history: ExplorerLocation[];
  historyIndex: number;
  selectedIds: string[];
  anchor: string | null;
  query: string;
  searchText: string;
  searchRevision: number;
  view: ExplorerViewMode;
  compact: boolean;
  sort: { key: "name" | "updatedAt" | "extension" | "size"; asc: boolean };
  expanded: string[];
};

type ExplorerTab = TabViewState & { id: string };
type TabStart = { location: ExplorerLocation; expanded: readonly string[]; selectedIds?: readonly string[] };
type TabPatch = Partial<TabViewState> | ((previous: TabViewState) => Partial<TabViewState>);
const ROOT_START: TabStart = { location: "root", expanded: ["root"] };
const EMPTY_IDS: string[] = [];
const noSubscription = () => () => {};
const zeroSnapshot = () => 0;
const nullSnapshot = () => null;

function createTab(id: string, view: ExplorerViewMode, start: TabStart): ExplorerTab {
  return { id, requestedLocation: start.location, history: [start.location], historyIndex: 0,
    selectedIds: [...(start.selectedIds ?? [])], anchor: start.selectedIds?.[0] ?? null, query: "", searchText: "", searchRevision: 0, view, compact: false,
    sort: { key: "name", asc: true }, expanded: [...start.expanded] };
}

function equalValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key =>
      Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return false;
}

type WindowActions = {
  updateTabState: <K extends keyof TabViewState>(key: K, action: SetStateAction<TabViewState[K]>) => void;
  patchTabState: (patch: TabPatch) => void;
  addTab: (start?: TabStart) => string;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
};
type WindowSnapshot = WindowActions & { tabs: ExplorerTab[]; activeTab: ExplorerTab; activeTabId: string };
type WindowBucket = { id: string; tabs: ExplorerTab[]; ids: string[]; activeId: string; actions: WindowActions;
  snapshot: WindowSnapshot; listeners: Set<() => void> };

/** Indexed tab state; each window subscribes only to its own immutable snapshot. */
function createTabsStore(defaultView: ExplorerViewMode, initialStart: TabStart, newTabStart: TabStart) {
  let nextId = 1;
  const first = createTab("tab-1", defaultView, initialStart);
  const records = new Map([[first.id, first]]);
  const owners = new Map([[first.id, "main"]]);
  const order = new Map([[first.id, 1]]);
  const windows = new Map<string, WindowBucket>();
  const listeners = new Set<() => void>();
  const changed = new Set<WindowBucket>();
  let allTabs: ExplorerTab[] | null = [first];
  let version = 0;
  let batching = 0;
  let settings = { defaultView, initialStart: newTabStart };

  function getBucket(windowId: string): WindowBucket {
    const existing = windows.get(windowId);
    if (existing) return existing;
    const actions: WindowActions = {
      updateTabState: (key, action) => patchTabState(windowId, previous => ({
        [key]: typeof action === "function"
          ? (action as (old: TabViewState[typeof key]) => TabViewState[typeof key])(previous[key]) : action,
      })),
      patchTabState: patch => patchTabState(windowId, patch),
      addTab: start => addTab(windowId, start ?? settings.initialStart),
      selectTab: id => selectTab(windowId, id),
      closeTab: id => closeTab(windowId, id),
    };
    const bucket: WindowBucket = { id: windowId, tabs: [], ids: EMPTY_IDS, activeId: "", actions,
      snapshot: { ...actions, tabs: [], activeTab: first, activeTabId: first.id }, listeners: new Set() };
    windows.set(windowId, bucket);
    return bucket;
  }
  function refresh(bucket: WindowBucket) {
    const activeTab = records.get(bucket.activeId) ?? bucket.tabs[0] ?? records.values().next().value ?? first;
    bucket.snapshot = { ...bucket.actions, tabs: bucket.tabs, activeTab, activeTabId: activeTab.id };
    changed.add(bucket);
  }
  function publish() {
    if (batching || !changed.size) return;
    const pending = [...changed];
    changed.clear();
    version++;
    for (const callback of [...listeners]) callback();
    for (const bucket of pending) {
      for (const callback of [...bucket.listeners]) callback();
      if (!bucket.tabs.length && !bucket.listeners.size && windows.get(bucket.id) === bucket) windows.delete(bucket.id);
    }
  }
  function batch<T>(callback: () => T): T {
    batching++;
    try { return callback(); }
    finally { batching--; publish(); }
  }
  function patchTabState(windowId: string, patch: TabPatch) {
    const bucket = getBucket(windowId);
    const previous = records.get(bucket.activeId);
    if (!previous) return;
    const values = typeof patch === "function" ? patch(previous) : patch;
    if (Object.entries(values).every(([key, value]) => equalValue(previous[key as keyof TabViewState], value))) return;
    const next = { ...previous, ...values };
    records.set(next.id, next);
    bucket.tabs = bucket.tabs.map(tab => tab.id === next.id ? next : tab);
    allTabs = null;
    refresh(bucket);
    publish();
  }
  function addTab(windowId: string, start: TabStart) {
    const id = `tab-${++nextId}`;
    const tab = createTab(id, settings.defaultView, start);
    records.set(id, tab); owners.set(id, windowId); order.set(id, nextId);
    const bucket = getBucket(windowId);
    bucket.tabs = [...bucket.tabs, tab]; bucket.ids = [...bucket.ids, id]; bucket.activeId = id;
    allTabs = null;
    refresh(bucket); publish();
    return id;
  }
  function selectTab(windowId: string, id: string) {
    const bucket = getBucket(windowId);
    if (owners.get(id) !== windowId || bucket.activeId === id) return;
    bucket.activeId = id; refresh(bucket); publish();
  }
  function closeTab(windowId: string, id: string) {
    const bucket = getBucket(windowId);
    const index = bucket.ids.indexOf(id);
    if (index < 0 || bucket.tabs.length <= 1) return;
    bucket.tabs = bucket.tabs.filter(tab => tab.id !== id);
    bucket.ids = bucket.ids.filter(tabId => tabId !== id);
    if (bucket.activeId === id) bucket.activeId = bucket.ids[Math.min(index, bucket.ids.length - 1)];
    records.delete(id); owners.delete(id); order.delete(id); allTabs = null;
    refresh(bucket); publish();
  }
  function detachTab(id: string, windowId: string, sourceWindowId = "main") {
    const source = getBucket(sourceWindowId);
    if (!windowId || windowId === "main" || windowId === sourceWindowId || owners.get(id) !== sourceWindowId || source.tabs.length <= 1) return false;
    const target = getBucket(windowId);
    const tab = records.get(id)!;
    owners.set(id, windowId);
    source.tabs = source.tabs.filter(item => item.id !== id); source.ids = source.ids.filter(item => item !== id);
    if (source.activeId === id) source.activeId = source.ids[0];
    target.tabs = [...target.tabs, tab].sort((left, right) => order.get(left.id)! - order.get(right.id)!);
    target.ids = target.tabs.map(item => item.id); target.activeId = id;
    refresh(source); refresh(target); publish();
    return true;
  }
  function reattachWindow(windowId: string, sourceWindowId = "main") {
    if (windowId === "main") return;
    const source = windows.get(windowId);
    if (!source?.tabs.length) return;
    const destination = sourceWindowId !== windowId && windows.get(sourceWindowId)?.tabs.length ? sourceWindowId : "main";
    const target = getBucket(destination);
    for (const id of source.ids) owners.set(id, destination);
    target.tabs = [...target.tabs, ...source.tabs].sort((left, right) => order.get(left.id)! - order.get(right.id)!);
    target.ids = target.tabs.map(tab => tab.id); target.activeId = source.activeId;
    source.tabs = []; source.ids = EMPTY_IDS; source.activeId = "";
    refresh(source); refresh(target); publish();
  }
  function closeWindows(windowIds: readonly string[]) {
    batch(() => {
      for (const windowId of windowIds) {
        if (windowId === "main") continue;
        const bucket = windows.get(windowId);
        if (!bucket?.tabs.length) continue;
        for (const id of bucket.ids) { records.delete(id); owners.delete(id); order.delete(id); }
        bucket.tabs = []; bucket.ids = EMPTY_IDS; bucket.activeId = ""; allTabs = null;
        refresh(bucket);
      }
    });
  }
  const main = getBucket("main");
  main.tabs = [first]; main.ids = [first.id]; main.activeId = first.id;
  refresh(main); changed.clear();
  const forWindow = (windowId: string) => getBucket(windowId).snapshot;
  return {
    get tabs() { return forWindow("main").tabs; },
    get activeTab() { return forWindow("main").activeTab; },
    get activeTabId() { return forWindow("main").activeTabId; },
    ...main.actions,
    forWindow, detachTab, reattachWindow, restoreWindow: reattachWindow,
    closeWindow: (id: string) => closeWindows([id]), closeWindows, batch,
    get allTabs() { return allTabs ??= [...records.values()]; },
    getWindowTabIds: (windowId: string) => [...(windows.get(windowId)?.ids ?? EMPTY_IDS)],
    configure: (view: ExplorerViewMode, start: TabStart) => { settings = { defaultView: view, initialStart: start }; },
    subscribe: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    getSnapshot: () => version,
    subscribeWindow: (windowId: string, callback: () => void) => {
      const bucket = getBucket(windowId);
      bucket.listeners.add(callback);
      return () => {
        bucket.listeners.delete(callback);
        if (!bucket.tabs.length && !bucket.listeners.size && windows.get(windowId) === bucket) windows.delete(windowId);
      };
    },
  };
}

export type ExplorerTabs = ReturnType<typeof createTabsStore>;

/** Standalone callers observe all tabs; workspaces let panes subscribe separately. */
export function useExplorerTabs(defaultView: ExplorerViewMode = "details", initialStart: TabStart = ROOT_START, subscribe = true, newTabStart: TabStart = initialStart) {
  const [store] = useState(() => createTabsStore(defaultView, initialStart, newTabStart));
  useLayoutEffect(() => { store.configure(defaultView, newTabStart); }, [store, defaultView, newTabStart]);
  useSyncExternalStore(subscribe ? store.subscribe : noSubscription, subscribe ? store.getSnapshot : zeroSnapshot, zeroSnapshot);
  return store;
}

export function useExplorerWindowTabs(store: Pick<ExplorerTabs, "forWindow"> & Partial<Pick<ExplorerTabs, "subscribeWindow">>, windowId: string) {
  const subscribe = useCallback((callback: () => void) => store.subscribeWindow?.(windowId, callback) ?? noSubscription(), [store, windowId]);
  const getSnapshot = useCallback(() => store.forWindow(windowId), [store, windowId]);
  const snapshot = useSyncExternalStore(subscribe, store.subscribeWindow ? getSnapshot : nullSnapshot, store.subscribeWindow ? getSnapshot : nullSnapshot);
  return snapshot ?? store.forWindow(windowId);
}
