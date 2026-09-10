"use client";

import {
  useCallback,
  useEffect,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import {
  FAVORITES,
  RECENT,
  type ExplorerLocation,
  type ExplorerDialogState,
  type ExplorerNotification,
} from "./view-state";
import type { ExplorerProps } from "../props";
import { getEntryPath, normalizeEntryName } from "../model/entries";
import { isSameFolderMove, type ExplorerAction, type ExplorerEntry as Entry } from "../model/draft";
import { resolveExplorerOptions, type ExplorerViewMode } from "../model/config";
import { useExplorerWorkspace, type ExplorerWorkspace, type WindowPosition } from "./use-explorer-workspace";
import { useExplorerDownload } from "./use-explorer-download";
import type { ExplorerEditIntent } from "../model/edit-session";
import { describeEntry } from "../model/item-info";
import { createPreviewRequest } from "../model/preview";
import { dispatchExplorerEvent, type ExplorerViewEvent, type ExplorerLocationInfo } from "../model/events";
import { useExplorerWindowTabs, type TabViewState } from "./use-explorer-tabs";
import { getEntryIndex } from "../model/entry-index";
import { useExplorerUpload } from "./use-explorer-upload";
import { useExplorerContextMenu } from "./use-explorer-context-menu";
import { useExplorerListing } from "./use-explorer-listing";
import { useExplorerSearch } from "./use-explorer-search";
import { captureClipboardImport } from "./clipboard-import";
import { hasKeyModifiers, isComposingKeyEvent, matchesExplorerShortcut } from "../model/keyboard";
import {
  DEFAULT_ROOT_LABEL,
  formatExplorerPath,
  resolveExplorerPath,
} from "../model/path";

const DEFAULT_SORT: TabViewState["sort"] = { key: "name", asc: true };
type RenameSession = {
  id: string;
  revision: number;
  tabId: string;
  value: string;
  extension: string;
  error: string;
};

export function useExplorerController(props: ExplorerProps) {
  const workspace = useExplorerWorkspace(props);
  return useExplorerViewController(props, workspace);
}

export function useExplorerViewController({
  readFile,
  onDownloadRequest,
  onPreviewRequest,
  onSearchRequest,
  getContextMenuItems,
  contextMenuExecutionMode,
  search: searchOptions,
  previewTrigger = "doubleClick",
  onEvent,
  renderIcon,
  rootLabel: label,
  features: featureOptions,
  selection: selectionConfig,
  ui: uiConfig,
  view: viewConfig,
}: ExplorerProps, workspace: ExplorerWorkspace, windowId = "main",
  ownerDocument: Document | null = typeof document === "undefined" ? null : document,
) {
  const { defaultStart, initialStart, clipboard: storedClipboard, setClipboard, draggedIds: draggedIdsRef, workspaceId } = workspace;
  const rootLabel = label?.trim() || DEFAULT_ROOT_LABEL;
  const readOnly = workspace.draft.readOnly;
  const options = useMemo(() => resolveExplorerOptions({
    features: featureOptions, selection: selectionConfig, ui: uiConfig, view: viewConfig, readOnly,
  }), [featureOptions, selectionConfig, uiConfig, viewConfig, readOnly]);
  const { features, selection: selectionOptions, ui: uiOptions } = options;
  const canEditFavorites = features.favorites && !readOnly;
  const allowedViewModes = options.view.allowedModes;
  const currentOptions = useRef(options);
  // Action handlers use committed policy, even from child layout effects;
  // a suspended render must not enable editing in the currently visible view.
  useInsertionEffect(() => { currentOptions.current = options; }, [options]);
  const eventObserver = useRef(onEvent);
  useLayoutEffect(() => { eventObserver.current = onEvent; }, [onEvent]);
  function emitEvent(event: ExplorerViewEvent) {
    dispatchExplorerEvent(eventObserver.current, windowId === "main" ? event : { ...event, windowId });
  }
  const mounted = useRef(true);
  const {
    entries,
    dirty,
    saving,
    refreshing,
    refreshError,
    canRefresh,
    editMode,
    editRevision,
    saveError,
    save,
    discard,
  } = workspace.draft;
  const busy = saving || refreshing || editMode === "requesting" || workspace.draft.mutationBlocked;
  const currentDraft = useRef(workspace.draft);
  useInsertionEffect(() => { currentDraft.current = workspace.draft; }, [workspace.draft]);
  const cancelEditRequest = useCallback((sourceWindowId?: string) => {
    // Browsing may continue while a custom action owns its captured target.
    // Its own AbortSignal handles cancellation of its permission request.
    if (!currentDraft.current.contextMenuBusy) currentDraft.current.cancelEditRequest(sourceWindowId);
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    const cancelPending = () => cancelEditRequest(windowId);
    ownerDocument?.defaultView?.addEventListener?.("pagehide", cancelPending);
    return () => {
      mounted.current = false;
      cancelPending();
      ownerDocument?.defaultView?.removeEventListener?.("pagehide", cancelPending);
    };
  }, [cancelEditRequest, windowId, ownerDocument]);
  const tabState = useExplorerWindowTabs(workspace.tabs, windowId);
  const entryIndex = getEntryIndex(entries);
  const {
    requestedLocation,
    history,
    historyIndex,
    selectedIds,
    anchor,
    query: storedQuery,
    searchText: storedSearchText,
    searchRevision,
    view: storedView,
    compact,
    sort: storedSort,
    expanded,
  } = tabState.activeTab;
  const query = features.search ? storedQuery.trim() : "";
  const searchText = features.search ? storedSearchText : "";
  const searchTrigger = searchOptions?.trigger ?? "input";
  const composingSearch = useRef(false);
  const canSort = features.sort && !(query && onSearchRequest);
  const view = allowedViewModes.includes(storedView) ? storedView : options.view.defaultMode;
  const sort = features.sort ? storedSort : DEFAULT_SORT;
  function tabSetter<K extends keyof TabViewState>(key: K) {
    return (value: SetStateAction<TabViewState[K]>) =>
      tabState.updateTabState(key, value);
  }
  const updateSelected = tabSetter("selectedIds"),
    setAnchor = tabSetter("anchor"),
    setView = tabSetter("view"),
    setCompact = tabSetter("compact"),
    updateSort = tabSetter("sort"),
    setExpanded = tabSetter("expanded");
  function restrictSelection(ids: string[]) {
    if (selectionOptions.mode === "none") return [];
    const unique = [...new Set(ids)];
    return selectionOptions.mode === "single" ? unique.slice(0, 1) : unique;
  }
  function setSelected(action: SetStateAction<string[]>) {
    updateSelected(current => restrictSelection(
      typeof action === "function" ? action(restrictSelection(current)) : action,
    ));
  }
  function setQuery(action: SetStateAction<string>) {
    if (!features.search) return;
    const commit = searchTrigger === "input" && !composingSearch.current;
    tabState.patchTabState(previous => {
      const text = typeof action === "function" ? action(previous.searchText) : action;
      const nextQuery = commit || !text.trim() ? text.trim() : previous.query;
      return { searchText: text, query: nextQuery,
        ...(nextQuery !== previous.query ? { selectedIds: [], anchor: null } : {}) };
    });
  }
  function setSearchComposing(value: boolean) {
    composingSearch.current = value;
  }
  function submitSearch() {
    if (!features.search || composingSearch.current) return;
    tabState.patchTabState(previous => ({ query: previous.searchText.trim(),
      searchRevision: previous.searchRevision + 1, selectedIds: [], anchor: null }));
  }
  function retrySearch() {
    if (!features.search) return;
    tabState.patchTabState(previous => ({ searchRevision: previous.searchRevision + 1 }));
  }
  function clearSearch() {
    composingSearch.current = false;
    tabState.patchTabState({ searchText: "", query: "", selectedIds: [], anchor: null });
  }
  function setSort(action: SetStateAction<TabViewState["sort"]>) {
    if (canSort) updateSort(action);
  }
  function canAct(action: ExplorerAction["action"], current: typeof options) {
    return !current.readOnly && current.features[action === "create" ? "createFolder" : action === "favorite" ? "favorites" : action];
  }
  function canShowModal(type: ExplorerDialogState["type"], current: typeof options, refreshAvailable: boolean) {
    if (type === "refresh") return refreshAvailable;
    return type === "help" || (type === "discard" ? !current.readOnly : canAct(type, current));
  }
  const [storedModal, updateModal] = useState<ExplorerDialogState | null>(null),
    [name, setName] = useState(""),
    [destination, setDestination] = useState("root"),
    [modalError, setModalError] = useState("");
  const modalRef = useRef<ExplorerDialogState | null>(null);
  const [modalRevision, setModalRevision] = useState(0);
  const setModal = useCallback((next: ExplorerDialogState | null) => {
    if (!next && modalRef.current) cancelEditRequest(windowId);
    modalRef.current = next;
    updateModal(next);
  }, [cancelEditRequest, windowId, updateModal]);
  const modal = storedModal && canShowModal(storedModal.type, options, canRefresh) &&
    (storedModal.type === "help" || storedModal.type === "discard" ||
      modalRevision === editRevision) ? storedModal : null;
  const [detailId, setDetailId] = useState<string | null>(null),
    [previewId, setPreviewId] = useState<string | null>(null);
  const clipboard = storedClipboard && features[storedClipboard.action] ? storedClipboard : null;
  const currentClipboard = useRef(storedClipboard);
  useLayoutEffect(() => { currentClipboard.current = storedClipboard; }, [storedClipboard]);
  const pendingPaste = useRef<{
    controller: AbortController;
    hasDirectories: boolean;
    hasRootFiles: boolean;
  } | null>(null);
  const pendingPickers = useRef<Partial<Record<"file" | "folder", {
    parent: string;
    controller: AbortController;
    unregister: () => void;
  }>>>({});
  const cancelFilePicker = useCallback((source: "file" | "folder") => {
    const picker = pendingPickers.current[source];
    picker?.controller.abort();
    picker?.unregister();
  }, []);
  useLayoutEffect(() => () => {
    cancelFilePicker("file");
    cancelFilePicker("folder");
  }, [cancelFilePicker]);
  useEffect(() => {
    if (!features.uploadFiles) cancelFilePicker("file");
    if (!features.uploadFolders) cancelFilePicker("folder");
  }, [features.uploadFiles, features.uploadFolders, cancelFilePicker]);
  useEffect(() => () => { pendingPaste.current?.controller.abort(); }, []);
  useEffect(() => {
    const pending = pendingPaste.current;
    if (pending && ((pending.hasDirectories && !features.uploadFolders) ||
      (pending.hasRootFiles && !features.uploadFiles))) pending.controller.abort();
  }, [features.uploadFiles, features.uploadFolders]);
  const [renameSession, setRenameSession] = useState<RenameSession | null>(null);
  const renameSessionRef = useRef<RenameSession | null>(null);
  const cancelRename = useCallback((id?: string) => {
    if (!renameSessionRef.current || (id && renameSessionRef.current.id !== id)) return;
    renameSessionRef.current = null;
    setRenameSession(null);
    cancelEditRequest(windowId);
  }, [cancelEditRequest, windowId]);
  const pendingRename = useRef<RenameSession | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null),
    [externalDrag, setExternalDrag] = useState(false);
  const [previousEditRevision, setPreviousEditRevision] = useState(editRevision);
  const endedEdit = previousEditRevision !== editRevision;
  if (endedEdit) setPreviousEditRevision(editRevision);
  // Cancel edit state before children render under a changed access policy.
  if (readOnly || endedEdit) {
    if (renameSession) setRenameSession(null);
    if (storedModal && storedModal.type !== "help" && (endedEdit || storedModal.type !== "refresh")) updateModal(null);
    if (dragOver !== null) setDragOver(null);
    if (externalDrag) setExternalDrag(false);
  }
  const transientRevision = useRef(editRevision);
  useLayoutEffect(() => {
    const ended = transientRevision.current !== editRevision;
    transientRevision.current = editRevision;
    if (!readOnly && !ended) return;
    renameSessionRef.current = null;
    modalRef.current = null;
    currentClipboard.current = null;
    pendingPaste.current?.controller.abort();
    cancelFilePicker("file");
    cancelFilePicker("folder");
  }, [readOnly, editRevision, cancelFilePicker]);
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    addressInput = useRef<HTMLInputElement>(null),
    nameInput = useRef<HTMLInputElement>(null),
    workspaceRef = useRef<HTMLDivElement>(null);
  const focusEntryRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    const file = fileInput.current, folder = folderInput.current;
    const cancelFile = () => cancelFilePicker("file");
    const cancelFolder = () => cancelFilePicker("folder");
    file?.addEventListener?.("cancel", cancelFile);
    folder?.addEventListener?.("cancel", cancelFolder);
    return () => {
      file?.removeEventListener?.("cancel", cancelFile);
      folder?.removeEventListener?.("cancel", cancelFolder);
    };
  }, [features.uploadFiles, features.uploadFolders, cancelFilePicker]);
  const [notification, setNotification] = useState<ExplorerNotification | null>(() => windowId === "main" && initialStart.error ? {
    kind: "error",
    message: "初期フォルダ・ファイルの指定を確認してください",
    description: initialStart.error,
  } : null);
  function notify(
    kind: "success" | "error" | "info",
    message: string,
    options?: Pick<ExplorerNotification, "description" | "details" | "hint" | "persistent">,
  ) {
    const next = { kind, message, description: options?.description,
      details: options?.details, hint: options?.hint,
      ...(options?.persistent ? { persistent: true } : {}) };
    setNotification(next);
    return next;
  }
  /** Preserve the gesture's targets across authorization; never replay a stale view. */
  function runEdit(intent: ExplorerEditIntent, operation: () => boolean, onError?: (error: unknown) => void): boolean | Promise<boolean> {
    const draft = currentDraft.current;
    if (!mounted.current || !draft.canMutate() || draft.saving || draft.refreshing || currentOptions.current.readOnly) return false;
    if (intent.action !== "upload" && intent.action !== "save" && !canAct(intent.action, currentOptions.current)) return false;
    const origin = workspace.tabs.forWindow(windowId);
    const tabId = origin.activeTabId;
    const requestedLocation = origin.activeTab.requestedLocation;
    const originalIndex = getEntryIndex(draft.getEntries());
    const targetKinds = new Map(intent.ids?.map(id => [id, originalIndex.byId.get(id)?.kind]));
    const result = draft.requestEdit({ ...intent, windowId });
    const requestId = draft.getEditState().requestId;
    const finish = (allowed: boolean) => {
      if (!mounted.current || !draft.canMutate() || currentOptions.current.readOnly || ownerDocument?.defaultView?.closed) return false;
      const session = draft.getEditState();
      if (!allowed) {
        if (session.error && (typeof result === "boolean" || session.errorRequestId === requestId)) {
          if (onError) onError(new Error(session.error));
          else notify("error", session.error);
        }
        return false;
      }
      const currentTab = workspace.tabs.forWindow(windowId);
      if (session.mode !== "edit" || session.requestId !== requestId ||
        currentTab.activeTabId !== tabId || currentTab.activeTab.requestedLocation !== requestedLocation ||
        currentDraft.current.saving || currentDraft.current.refreshing || (intent.action !== "upload" && intent.action !== "save" && !canAct(intent.action, currentOptions.current))) return false;
      try {
        const latest = getEntryIndex(draft.getEntries());
        if (intent.ids?.some(id => !latest.byId.has(id) || latest.byId.get(id)?.kind !== targetKinds.get(id)))
          throw new Error("対象の項目が更新されています。一覧から選び直してください");
        if (intent.parent && intent.parent !== "root" && latest.byId.get(intent.parent)?.kind !== "folder")
          throw new Error("追加先・移動先のフォルダが見つかりません。一覧から選び直してください");
        return operation();
      } catch (error) {
        if (onError) onError(error);
        else notify("error", error instanceof Error ? error.message : "操作できませんでした");
        return false;
      }
    };
    return typeof result === "boolean" ? finish(result) : result.then(finish);
  }
  useEffect(() => {
    if (!notification || notification.persistent) return;
    const timeout = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timeout);
  }, [notification]);
  const download = useExplorerDownload({ entries, enabled: features.download, readFile, onDownloadRequest,
    manager: workspace.downloads, windowId, ownerDocument, emitEvent, setNotification });
  const instanceId = useId();
  const entryId = (id: string) => `${instanceId}-entry-${id}`;
  const [mobileOpen, setOpenMobile] = useState(false);
  const resolveLocation = useCallback((requested: ExplorerLocation): ExplorerLocation => {
    return requested === "root" ||
      (requested === FAVORITES && features.favorites) ||
      (requested === RECENT && features.recent) ||
      entryIndex.byId.get(requested as string)?.kind === "folder"
      ? requested
      : "root";
  }, [entryIndex, features.favorites, features.recent]);
  const locationTitle = useCallback((value: ExplorerLocation): string => {
    return value === "root"
      ? rootLabel
      : value === FAVORITES
        ? "お気に入り"
        : value === RECENT
          ? "最近更新したファイル"
          : (entryIndex.byId.get(value as string)?.name ?? "フォルダ");
  }, [entryIndex, rootLabel]);
  const location = resolveLocation(requestedLocation);
  const folder = entryIndex.byId.get(location as string),
    special = location === FAVORITES || location === RECENT,
    currentParent = typeof location === "string" ? location : "root";
  const title = locationTitle(location);
  const tabLocations = useMemo(() => Object.fromEntries(
    tabState.tabs.map(tab => [tab.id, resolveLocation(tab.requestedLocation)] as const),
  ), [tabState.tabs, resolveLocation]);
  const tabs = useMemo(() => (features.tabs ? tabState.tabs : [tabState.activeTab]).map((tab) => ({
    id: tab.id,
    title: features.search && tab.query
      ? "検索結果"
      : locationTitle(resolveLocation(tab.requestedLocation)),
  })), [features.tabs, features.search, tabState.tabs, tabState.activeTab, locationTitle, resolveLocation]);
  function clearTransientState() {
    composingSearch.current = false;
    cancelEditRequest(windowId);
    cancelRename();
    setModal(null);
    setPreviewId(null);
    setDetailId(null);
    endDrag();
    setOpenMobile(false);
  }
  function addTab() {
    if (!features.tabs) return;
    clearTransientState();
    const location = resolveLocation(defaultStart.location);
    return tabState.addTab({
      location,
      expanded: ["root", ...getEntryPath(entries, location as string).map(entry => entry.id)],
    });
  }
  function selectTab(id: string) {
    if (!features.tabs) return;
    if (id === tabState.activeTabId) return;
    clearTransientState();
    tabState.selectTab(id);
  }
  function closeTab(id: string) {
    if (!features.tabs) return;
    if (id === tabState.activeTabId && tabState.tabs.length > 1)
      clearTransientState();
    tabState.closeTab(id);
  }
  function detachTab(id: string, position?: WindowPosition): boolean {
    const windowTabIds = workspace.tabs.getWindowTabIds(windowId);
    if (!features.tabs || !features.detachTabs || windowTabIds.length <= 1 || !windowTabIds.includes(id)) return false;
    if (workspace.detachTab(id, ownerDocument, position, windowId, () => {
      if (mounted.current) notify("error", "別ウィンドウを表示できなかったため、タブを復元しました", {
        description: "ブラウザが新しいウィンドウを閉じたか、表示を完了できませんでした",
      });
    })) {
      clearTransientState();
      return true;
    }
    notify("error", "別ウィンドウを開けませんでした", {
      description: "ポップアップを許可し、タブの右クリックから「別ウィンドウで開く」を選んでください",
    });
    return false;
  }
  function reattachWindow() {
    if (windowId !== "main") workspace.reattachWindow(windowId);
  }
  const displayedSort =
    location === RECENT ? { key: "updatedAt" as const, asc: false } : sort;
  const crumbs = useMemo(() => getEntryPath(entries, currentParent), [entries, currentParent]);
  const addressPath = formatExplorerPath(entries, currentParent);
  function navigatePath(value: string) {
    if (!features.pathInput) return;
    navigate(resolveExplorerPath(entries, value, currentParent, rootLabel));
  }
  const details = features.details ? entryIndex.byId.get(detailId ?? "") : undefined,
    preview = features.preview && !onPreviewRequest ? entryIndex.byId.get(previewId ?? "") : undefined;
  const { totalSize, fileCount } = entryIndex;
  const locationInfo = useMemo<ExplorerLocationInfo>(() => typeof location === "string"
    ? { kind: "folder", id: location, name: title, path: addressPath }
    : { kind: location === FAVORITES ? "favorites" : "recent", id: null, name: title, path: null },
  [location, title, addressPath]);
  const { resultIds, searchPending, searchError, externalSearch } = useExplorerSearch({
    enabled: features.search, query, entries, location: locationInfo,
    tabId: tabState.activeTabId, windowId, onSearchRequest, trigger: searchTrigger,
    debounceMs: searchOptions?.debounceMs, revision: searchRevision, ownerDocument,
  });
  const { visible, visiblePositions, selected, selectedSet, selectedEntries } = useExplorerListing({
    entries, location, query, sort, selectedIds, selectionMode: selectionOptions.mode,
    searchResultIds: resultIds,
  });
  const renamingEntryId = features.rename && !readOnly && !saving && !refreshing &&
    renameSession?.revision === editRevision &&
    renameSession?.tabId === tabState.activeTabId &&
    visiblePositions.has(renameSession.id)
    ? renameSession.id
    : null;

  // Observe committed UI state, never React updater functions (which can replay).
  // Keep the baseline even without a handler so attaching one does not replay history.
  const { key: displayedSortKey, asc: displayedSortAsc } = displayedSort;
  const viewInfo = useMemo(() => ({ mode: view, compact, query, sort: { key: displayedSortKey, asc: displayedSortAsc } }),
    [view, compact, query, displayedSortKey, displayedSortAsc]);
  const activeTabId = tabState.activeTabId;
  const observedDetailId = details?.id ?? null;
  // Serialization scales with the selection/tab count. Reuse signatures while
  // unrelated UI state (for example a rename keystroke) changes.
  const observedKeys = useMemo(() => ({
    navigate: JSON.stringify(locationInfo),
    selection: JSON.stringify(selected),
    tabs: JSON.stringify({ tabs, activeTabId }),
    view: JSON.stringify(viewInfo),
    details: JSON.stringify(observedDetailId),
  }), [locationInfo, selected, tabs, activeTabId, viewInfo, observedDetailId]);
  const observedState = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const keys = observedKeys;
    const previous = observedState.current;
    observedState.current = keys;
    if (!previous || !onEvent) return;
    const events: ExplorerViewEvent[] = [];
    if (previous.navigate !== keys.navigate)
      events.push({ type: "navigate", location: { ...locationInfo } });
    if (previous.selection !== keys.selection)
      events.push({ type: "selection", ids: [...selected], entries: selectedEntries.map(entry => describeEntry(entries, entry)) });
    if (previous.tabs !== keys.tabs)
      events.push({ type: "tabs", activeTabId: tabState.activeTabId, tabs: tabs.map(tab => ({ ...tab })) });
    if (previous.view !== keys.view)
      events.push({ type: "view", ...viewInfo, sort: { ...viewInfo.sort } });
    if (previous.details !== keys.details)
      events.push({ type: "details", entry: details ? describeEntry(entries, details) : null });
    for (const event of events) emitEvent(event);
  });

  function startRename(ids = selected) {
    if (busy || !canAct("rename", currentOptions.current) || ids.length !== 1) return;
    const entry = visible.find((item) => item.id === ids[0]);
    if (!entry) return;
    clearTransientState();
    setSelected([entry.id]);
    const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
    const extension = dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot) : "";
    const session = {
      id: entry.id,
      revision: currentDraft.current.getEditRevision(),
      tabId: tabState.activeTabId,
      value: extension ? entry.name.slice(0, -extension.length) : entry.name,
      extension,
      error: "",
    };
    renameSessionRef.current = session;
    setRenameSession(session);
    return true;
  }
  function setRenameValue(value: string) {
    const session = renameSessionRef.current;
    if (!session || session.id !== renamingEntryId || pendingRename.current === session) return;
    const next = { ...session, value, error: "" };
    renameSessionRef.current = next;
    setRenameSession(next);
  }
  function commitRename(id?: string): boolean | Promise<boolean> {
    const session = renameSessionRef.current;
    if (!session || (id && session.id !== id) || pendingRename.current === session) return false;
    if (!canAct("rename", currentOptions.current) || session.id !== renamingEntryId ||
      session.revision !== currentDraft.current.getEditRevision()) {
      cancelRename(session.id);
      return false;
    }
    const fail = (error: unknown) => {
      if (renameSessionRef.current !== session) return;
      const next = { ...session, error: error instanceof Error ? error.message : "名前を変更できませんでした" };
      renameSessionRef.current = next;
      setRenameSession(next);
    };
    try {
      const entry = getEntryIndex(currentDraft.current.getEntries()).byId.get(session.id);
      if (!entry) {
        cancelRename(session.id);
        return false;
      }
      if (!session.value.trim()) throw new Error("名前を入力してください");
      const nextName = normalizeEntryName(session.value + session.extension);
      const dot = nextName.lastIndexOf(".");
      if (entry.kind === "file" && !session.extension && dot > 0 && dot < nextName.length - 1)
        throw new Error("拡張子のないファイルに拡張子を追加することはできません");
      const commit = currentDraft.current.prepareAction({ action: "rename", ids: [entry.id], name: nextName });
      if (!commit) {
        cancelRename(session.id);
        return true;
      }
      pendingRename.current = session;
      const result = runEdit({ action: "rename", ids: [entry.id] }, () => {
        if (renameSessionRef.current !== session || session.revision !== currentDraft.current.getEditRevision()) return false;
        if (commit()) notify("success", "名前を変更しました", { description: "保存すると変更が確定します" });
        cancelRename(session.id);
        return true;
      }, fail);
      const finish = (success: boolean) => {
        if (pendingRename.current === session) pendingRename.current = null;
        return success;
      };
      return typeof result === "boolean" ? finish(result) : result.then(finish);
    } catch (error) {
      pendingRename.current = null;
      fail(error);
      return false;
    }
  }

  function changeView(mode: ExplorerViewMode) {
    if (allowedViewModes.includes(mode)) {
      cancelEditRequest(windowId);
      cancelRename();
      setView(mode);
    }
  }
  function changeCompact(value: SetStateAction<boolean>) {
    if (allowedViewModes.length > 1) setCompact(value);
  }
  const canDrag = features.copy || features.move;
  const canPaste = !busy && !special && !!clipboard && features[clipboard.action];
  function navigate(id: ExplorerLocation, record = true) {
    if ((id === FAVORITES && !features.favorites) || (id === RECENT && !features.recent)) return;
    cancelEditRequest(windowId);
    cancelRename();
    composingSearch.current = false;
    tabState.patchTabState(previous => {
      const nextHistory = record ? [...previous.history.slice(0, previous.historyIndex + 1), id] : previous.history;
      return {
        requestedLocation: id, selectedIds: [], anchor: null, query: "", searchText: "",
        history: nextHistory, historyIndex: record ? nextHistory.length - 1 : previous.historyIndex,
        expanded: typeof id === "string" && id !== "root"
          ? [...new Set([...previous.expanded, ...getEntryPath(entries, id).map(entry => entry.id)])]
          : previous.expanded,
      };
    });
    setOpenMobile(false);
  }
  function travel(direction: number) {
    const index = historyIndex + direction;
    if (index < 0 || index >= history.length) return;
    workspace.tabs.batch(() => {
      tabState.patchTabState({ historyIndex: index });
      navigate(resolveLocation(history[index]), false);
    });
  }

  function showModal(type: ExplorerDialogState["type"], ids = selected) {
    const creating = type === "create" || type === "createFile";
    if (busy || !canShowModal(type, currentOptions.current, currentDraft.current.canRefresh) || (creating && special)) return;
    const capturedIds = creating ? [] : [...ids];
    cancelRename();
    setModalRevision(currentDraft.current.getEditRevision());
    setModal({ type, ids: capturedIds });
    setModalError("");
    setName(type === "createFile" ? "新しいファイル.txt" : "");
    setDestination(currentParent);
    return true;
  }
  function act(
    action: ExplorerAction["action"],
    ids: string[] = selected,
    extra: { name?: string; parent?: string } = {},
    message = "変更しました",
  ) {
    if (busy || !canAct(action, currentOptions.current)) return false;
    const command = { action, ids: [...ids], ...extra };
    try {
      const commit = currentDraft.current.prepareAction(command);
      if (!commit) return false;
      return runEdit({ action, ids: command.ids, parent: command.parent }, () => {
        if (!commit()) return false;
        notify("success", message);
        if (action === "move" || action === "delete") setSelected([]);
        if (action === "move") setClipboard(null);
        return true;
      });
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "操作できませんでした");
      return false;
    }
  }
  function submitModal(): boolean | Promise<boolean> {
    if (!modal || busy || modal.type === "help" || !canShowModal(modal.type, currentOptions.current, currentDraft.current.canRefresh) || modalRef.current !== modal) return false;
    const submitted = modal;
    const fail = (error: unknown) => {
      if (modalRef.current === submitted)
        setModalError(error instanceof Error ? error.message : "操作できませんでした");
    };
    try {
      if (modal.type === "discard") {
        discard();
        setSelected([]);
        setAnchor(null);
        setClipboard(null);
        setPreviewId(null);
        setDetailId(null);
        notify("info", "未保存の変更を破棄しました");
        setModal(null);
        return true;
      }
      if (modal.type === "refresh") {
        if (modalRevision !== currentDraft.current.getEditRevision()) return false;
        setModal(null);
        return performRefresh();
      }
      if (modalRevision !== currentDraft.current.getEditRevision()) return false;
      const command = {
        action: modal.type,
        ids: modal.ids ? [...modal.ids] : [],
        name,
        parent: modal.type === "create" || modal.type === "createFile" ? currentParent : destination,
      };
      const commit = currentDraft.current.prepareAction(command);
      if (!commit) {
        setModal(null);
        return false;
      }
      setModalError("");
      return runEdit({ action: command.action, ids: command.ids, parent: command.parent }, () => {
        if (modalRef.current !== submitted || modalRevision !== currentDraft.current.getEditRevision()) return false;
        const changed = commit();
        if (changed) {
          const labels = { create: "フォルダを追加しました", createFile: "ファイルを作成しました",
            move: "移動しました", copy: "コピーしました", delete: "削除しました" };
          notify("success", labels[command.action], { description: "保存すると変更が確定します" });
          if (command.action === "move" || command.action === "delete") setSelected([]);
          if (command.action === "move") setClipboard(null);
        }
        setModal(null);
        return changed;
      }, fail);
    } catch (error) {
      fail(error);
      return false;
    }
  }

  async function saveChanges() {
    if (currentOptions.current.readOnly) return;
    const notificationRevision = workspace.notifications.getRevision();
    setNotification(null);
    const completion = save(windowId);
    const request = currentDraft.current.getEditState();
    const saved = await completion;
    if (!mounted.current) return;
    if (saved) {
      // A host can report its own progress/results while saving. Do not repeat
      // that result with a second generic completion notice.
      if (workspace.notifications.getRevision() === notificationRevision) notify("success", "保存しました");
    }
    else {
      const failure = currentDraft.current.getEditState();
      if (failure.error && failure.errorRequestId === (request.requestId ?? request.errorRequestId))
        notify("error", failure.error);
    }
  }
  async function refreshEntries(): Promise<boolean> {
    const draft = currentDraft.current;
    if (!mounted.current || !draft.canRefresh || draft.saving || draft.refreshing ||
      draft.getEditState().mode === "requesting") return false;
    if (draft.dirty) {
      // The user confirms in this pane; no data is discarded until refresh succeeds.
      showModal("refresh", []);
      return false;
    }
    return performRefresh();
  }
  async function performRefresh(): Promise<boolean> {
    setNotification(null);
    const refreshed = await currentDraft.current.refresh();
    if (mounted.current && refreshed) notify("success", "最新の一覧を読み込みました");
    return refreshed;
  }
  function endEditing() {
    try {
      currentDraft.current.endEdit();
      clearTransientState();
      setClipboard(null);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "編集を終了できませんでした");
    }
  }
  function cancelEditPermission() {
    cancelEditRequest();
  }
  function copyToClipboard(action: "move" | "copy", ids = selected, transfer?: DataTransfer) {
    if (!canAct(action, currentOptions.current) || !ids.length || busy) return;
    ids = [...ids];
    if (ids.some(id => !getEntryIndex(currentDraft.current.getEntries()).byId.has(id))) return false;
    {
      const nextClipboard = { action, ids: [...ids] };
      currentClipboard.current = nextClipboard;
      setClipboard(nextClipboard);
      emitEvent({ type: "clipboard", action, ids: [...ids] });
      const notice = notify(
        "info",
        `${ids.length}項目を${action === "move" ? "切り取り" : "コピー"}ました`,
        { description: "移動先のフォルダで貼り付けできます" },
      );
      // Replace old OS files so a later native paste uses this internal copy.
      // These are virtual paths, not local filesystem URLs or file contents.
      const latestEntries = currentDraft.current.getEntries();
      const latestIndex = getEntryIndex(latestEntries);
      const text = ids.flatMap(id => {
        const entry = latestIndex.byId.get(id);
        return entry ? [describeEntry(latestEntries, entry).path] : [];
      }).join("\n");
      function showClipboardFallback() {
        if (!mounted.current || currentOptions.current.readOnly || currentClipboard.current !== nextClipboard) return;
        setNotification(current => current === notice ? {
          ...current,
          description: "OSのクリップボードを更新できませんでした。移動先で画面内の「貼り付け」を使ってください",
        } : current);
      }
      try {
        if (transfer) {
          transfer.clearData();
          transfer.setData("text/plain", text);
        } else {
          const systemClipboard = ownerDocument?.defaultView?.navigator.clipboard;
          if (systemClipboard?.writeText) {
            void systemClipboard.writeText(text).catch(showClipboardFallback);
          } else showClipboardFallback();
        }
      } catch {
        showClipboardFallback();
      }
      return true;
    }
  }
  function paste() {
    const copied = workspace.getClipboard();
    const currentLocation = workspace.tabs.forWindow(windowId).activeTab.requestedLocation;
    if (!copied || typeof currentLocation !== "string" || currentDraft.current.saving || currentDraft.current.refreshing ||
      currentDraft.current.getEditState().mode === "requesting" || !canAct(copied.action, currentOptions.current)) return false;
    return act(
      copied.action,
      [...copied.ids],
      { parent: currentLocation },
      copied.action === "move" ? "移動しました" : "コピーしました",
    );
  }
  function openEntry(entry: Entry) {
    cancelRename();
    const currentEntry = entryIndex.byId.get(entry.id);
    if (!currentEntry) return;
    if (currentEntry.kind === "folder") {
      navigate(currentEntry.id);
      return;
    }
    if (!features.preview) return;
    const eventRequest = createPreviewRequest(entries, currentEntry.id);
    if (!eventRequest) return;
    emitEvent({ type: "preview", request: eventRequest, external: Boolean(onPreviewRequest) });
    if (!onPreviewRequest) {
      setPreviewId(currentEntry.id);
      return;
    }
    setPreviewId(null);
    const request = createPreviewRequest(entries, currentEntry.id);
    if (!request) return;
    const failed = (error: unknown) => {
      if (!mounted.current) return;
      notify("error", error instanceof Error ? error.message : "プレビューを開けませんでした");
    };
    try {
      void Promise.resolve(onPreviewRequest(request)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
  useEffect(() => {
    const id = workspace.takeInitialPreview(tabState.activeTabId);
    if (!id || !features.preview) return;
    const entry = entryIndex.byId.get(id);
    // Dispatch once after the view mounts, through the same UI/host boundary as a user preview.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (entry?.kind === "file" && entry.parent === currentParent) openEntry(entry);
  });
  function rowKey(event: React.KeyboardEvent, entry: Entry) {
    if (event.defaultPrevented || isComposingKeyEvent(event) || event.target !== event.currentTarget) return;
    if (matchesExplorerShortcut(event, "open")) {
      event.preventDefault();
      event.stopPropagation();
      setSelected([entry.id]);
      openEntry(entry);
    } else if (
      !hasKeyModifiers(event) &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      const index = (visiblePositions.get(entry.id) ?? -1);
      const next = visible[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        setSelected([next.id]);
        setAnchor(next.id);
        if (focusEntryRef.current) focusEntryRef.current(next.id);
        else ownerDocument?.getElementById(entryId(next.id))?.focus();
      }
    }
  }
  function selectEntry(entry: Entry, event: MouseEvent) {
    if (selectionOptions.mode === "none") return;
    if (selectionOptions.mode === "single") {
      setSelected([entry.id]);
      setAnchor(entry.id);
      return;
    }
    if (event.shiftKey && anchor) {
      const from = (visiblePositions.get(anchor) ?? -1),
        to = (visiblePositions.get(entry.id) ?? -1);
      if (from >= 0) {
        setSelected(
          visible
            .slice(Math.min(from, to), Math.max(from, to) + 1)
            .map((item) => item.id),
        );
        return;
      }
    }
    if (event.ctrlKey || event.metaKey)
      setSelected((old) =>
        old.includes(entry.id)
          ? old.filter((id) => id !== entry.id)
          : [...old, entry.id],
      );
    else setSelected([entry.id]);
    setAnchor(entry.id);
  }
  function toggleSelect(id: string) {
    if (selectionOptions.mode === "none") return;
    if (selectionOptions.mode === "single") {
      setSelected(old => old.includes(id) ? [] : [id]);
      setAnchor(id);
      return;
    }
    setSelected((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
    setAnchor(id);
  }
  function sortBy(key: typeof sort.key) {
    if (location !== RECENT)
      setSort((old) => ({ key, asc: old.key === key ? !old.asc : true }));
  }
  function startDrag(event: DragEvent, entry: Entry) {
    if (busy || (!canAct("copy", currentOptions.current) && !canAct("move", currentOptions.current))) {
      event.preventDefault();
      return;
    }
    const ids = selectedSet.has(entry.id) ? selected : [entry.id];
    draggedIdsRef.current = ids;
    setSelected(ids);
    event.dataTransfer.setData(
      "application/x-explorer",
      JSON.stringify({ instanceId: workspaceId, ids }),
    );
    event.dataTransfer.effectAllowed = features.copy && features.move ? "copyMove" : features.copy ? "copy" : "move";
  }
  function endDrag() {
    draggedIdsRef.current = null;
    setDragOver(null);
    setExternalDrag(false);
  }
  function allowDrop(event: DragEvent, id: string) {
    const internal = event.dataTransfer.types.includes("application/x-explorer");
    const external = event.dataTransfer.types.includes("Files");
    if (!internal && !external) return;
    event.preventDefault();
    event.stopPropagation();
    const sameFolder = internal && !event.ctrlKey && draggedIdsRef.current !== null &&
      isSameFolderMove(entries, draggedIdsRef.current, id);
    if (busy || currentOptions.current.readOnly || sameFolder || (internal ? !canAct(event.ctrlKey ? "copy" : "move", currentOptions.current) : !currentOptions.current.features.uploadFiles)) {
      event.dataTransfer.dropEffect = "none";
      setDragOver(null);
      return;
    }
    setDragOver(id);
    event.dataTransfer.dropEffect = internal ? (event.ctrlKey ? "copy" : "move") : "copy";
  }
  function drop(event: DragEvent, id: string) {
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    if (busy || currentOptions.current.readOnly) return;
    const raw = event.dataTransfer.getData("application/x-explorer");
    if (raw) {
      if (!features[event.ctrlKey ? "copy" : "move"]) return;
      try {
        const data = JSON.parse(raw);
        if (data.instanceId !== workspaceId || !Array.isArray(data.ids))
          throw new Error("このエクスプローラー内の項目を選択してください");
        if (!event.ctrlKey && isSameFolderMove(entries, data.ids, id)) return;
        act(
          event.ctrlKey ? "copy" : "move",
          data.ids,
          { parent: id },
          event.ctrlKey ? "コピーしました" : "移動しました",
        );
      } catch (error) {
        notify(
          "error",
          error instanceof Error ? error.message : "項目を選び直してください",
        );
      }
    } else if (features.uploadFiles && event.dataTransfer.files.length)
      addLocalFiles(Array.from(event.dataTransfer.files), "file", id);
  }
  const uploadImport = useExplorerUpload({
    draft: workspace.draft,
    uploadFiles: features.uploadFiles,
    uploadFolders: features.uploadFolders,
    registerImport: workspace.registerImport,
    cancelEditRequest: () => cancelEditRequest(windowId),
    ownerDocument,
    runEdit,
    notify,
  });
  const customMenu = useExplorerContextMenu({ workspace, options, provider: getContextMenuItems,
    mode: contextMenuExecutionMode, readFile, windowId, ownerDocument,
    tabId: tabState.activeTabId, selected, location: locationInfo,
    container: workspaceRef, upload: uploadImport, notify, emitEvent });
  function addLocalFiles(files: File[], source: "file" | "folder" = "file", parent = currentParent) {
    return uploadImport.start(files, parent, source === "folder" || files.some(file => !!file.webkitRelativePath));
  }

  function chooseFiles(directory = false) {
    if (busy || special || currentOptions.current.readOnly || !(directory ? currentOptions.current.features.uploadFolders : currentOptions.current.features.uploadFiles)) return;
    const source = directory ? "folder" : "file";
    const input = directory ? folderInput.current : fileInput.current;
    if (!input) return;
    cancelFilePicker(source);
    const controller = new AbortController();
    pendingPickers.current[source] = { parent: currentParent, controller, unregister: workspace.registerImport(controller) };
    try {
      input.click();
    } catch (error) {
      cancelFilePicker(source);
      notify("error", error instanceof Error ? error.message : "ファイル選択画面を開けませんでした");
    }
  }
  function acceptChosenFiles(files: File[], source: "file" | "folder" = "file") {
    const picker = pendingPickers.current[source];
    delete pendingPickers.current[source];
    picker?.unregister();
    if (picker?.controller.signal.aborted) return;
    return addLocalFiles(files, source, picker?.parent ?? currentParent);
  }
  useEffect(() => {
    if (!ownerDocument) return;
    function isWorkspaceCommand(event: Event) {
      const target = event.target as HTMLElement | null;
      const root = workspaceRef.current;
      const nearestRoot = target?.closest?.("[data-explorer-root]");
      if (
        event.defaultPrevented ||
        !target || !root?.contains(target) ||
        (nearestRoot && nearestRoot !== root)
      )
        return false;
      if (
        renamingEntryId ||
        modal ||
        uploadImport.prompt ||
        preview ||
        details ||
        Array.from(
          ownerDocument!.querySelectorAll('[role="menu"][data-state="open"]'),
        ).some(
          (menu) => menu.getAttribute("data-explorer-portal") === instanceId,
        )
      )
        return false;
      return !target.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    }
    function nativeCopy(event: ClipboardEvent) {
      if (!isWorkspaceCommand(event) || busy || currentOptions.current.readOnly || !selected.length || !event.clipboardData) return;
      const action = event.type === "cut" ? "move" : "copy";
      if (!features[action]) return;
      event.preventDefault();
      event.stopPropagation();
      copyToClipboard(action, selected, event.clipboardData);
    }
    function nativePaste(event: ClipboardEvent) {
      if (!isWorkspaceCommand(event) || busy || currentOptions.current.readOnly || special || !event.clipboardData) return;
      const data = event.clipboardData;
      // A file payload must never fall through to an older internal copy,
      // even when imports are disabled or the browser cannot expose its bytes.
      const hasFilePayload = data.files?.length || Array.from(data.items ?? []).some(item => item.kind === "file") ||
        Array.from(data.types ?? []).includes("Files");
      if (hasFilePayload) {
        pendingPaste.current?.controller.abort();
        if (!features.uploadFiles && !features.uploadFolders) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          // Capture entries while the clipboard event's data store is readable.
          const captured = captureClipboardImport(data);
          if (!captured) return;
          if ((captured.hasDirectories && !features.uploadFolders) ||
            (captured.hasRootFiles && !features.uploadFiles)) {
            notify("error", "貼り付けに含まれる項目の追加が無効になっています", {
              description: "許可されたファイルまたはフォルダだけをコピーしてください",
            });
            return;
          }
          if (!captured.hasDirectories) {
            addLocalFiles(captured.files);
            return;
          }
          const controller = new AbortController();
          pendingPaste.current = { controller, hasDirectories: captured.hasDirectories, hasRootFiles: captured.hasRootFiles };
          const unregister = workspace.registerImport(controller);
          const parent = currentParent;
          const notice = notify("info", "フォルダを読み込んでいます", {
            description: "読み込みが終わると、階層を保って一覧に追加します",
            persistent: true,
          });
          void captured.read(controller.signal).then(files => {
            const allowed = currentOptions.current.features;
            if (!mounted.current || controller.signal.aborted ||
              (captured.hasDirectories && !allowed.uploadFolders) ||
              (captured.hasRootFiles && !allowed.uploadFiles)) return;
            if (!files.length) {
              notify("info", "追加できるファイルがありませんでした", {
                description: "空のフォルダは取り込みません",
              });
              return;
            }
            addLocalFiles(files, "folder", parent);
          }).catch(error => {
            if (!mounted.current || controller.signal.aborted) return;
            notify("error", "フォルダを読み込めなかったため、追加を中止しました", {
              description: error instanceof Error ? error.message : "フォルダを選択して追加し直してください",
              persistent: true,
            });
          }).finally(() => {
            unregister();
            if (pendingPaste.current?.controller === controller) pendingPaste.current = null;
            if (mounted.current) setNotification(current => current === notice ? null : current);
          });
        } catch (error) {
          notify("error", "クリップボードのファイルを取得できませんでした", {
            description: error instanceof Error ? error.message : "ファイルまたはフォルダを選択して追加してください",
          });
        }
      } else if (canPaste) {
        event.preventDefault();
        event.stopPropagation();
        paste();
      }
    }
    function keyboard(event: KeyboardEvent) {
      if (isComposingKeyEvent(event) || !isWorkspaceCommand(event)) return;
      const input = event.target as HTMLElement;
      if (
        (input.closest('[role="tablist"]') &&
          (matchesExplorerShortcut(event, "delete") || matchesExplorerShortcut(event, "rename")))
      )
        return;
      if (features.search && matchesExplorerShortcut(event, "search")) {
        event.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (selectionOptions.mode === "multiple" && matchesExplorerShortcut(event, "selectAll")) {
        event.preventDefault();
        setSelected(visible.map((entry) => entry.id));
        return;
      }
      if (!currentOptions.current.readOnly && matchesExplorerShortcut(event, "save")) {
        event.preventDefault();
        if (!busy && !event.repeat && (dirty || editMode === "edit")) void saveChanges();
      } else if (canRefresh && matchesExplorerShortcut(event, "refresh")) {
        event.preventDefault();
        if (!busy && !event.repeat) void refreshEntries();
      } else if (features.rename && matchesExplorerShortcut(event, "rename") && selected.length === 1) {
        event.preventDefault();
        if (!busy && !event.repeat) startRename();
      } else if (features.delete && matchesExplorerShortcut(event, "delete") && selected.length) {
        event.preventDefault();
        if (!busy && !event.repeat) showModal("delete");
      } else if (busy) {
        return;
      } else if (
        matchesExplorerShortcut(event, "open") &&
        event.target === workspaceRef.current &&
        selected.length === 1
      ) {
        event.preventDefault();
        const entry = entryIndex.byId.get(selected[0]);
        if (entry) openEntry(entry);
      } else if (matchesExplorerShortcut(event, "clear")) {
        setSelected([]);
        setClipboard(null);
      } else if (matchesExplorerShortcut(event, "up")) {
        event.preventDefault();
        navigate(folder?.parent ?? "root");
      } else if (matchesExplorerShortcut(event, "back")) {
        event.preventDefault();
        travel(-1);
      } else if (matchesExplorerShortcut(event, "forward")) {
        event.preventDefault();
        travel(1);
      }
    }
    ownerDocument.addEventListener("keydown", keyboard);
    ownerDocument.addEventListener("copy", nativeCopy);
    ownerDocument.addEventListener("cut", nativeCopy);
    ownerDocument.addEventListener("paste", nativePaste);
    return () => {
      ownerDocument.removeEventListener("keydown", keyboard);
      ownerDocument.removeEventListener("copy", nativeCopy);
      ownerDocument.removeEventListener("cut", nativeCopy);
      ownerDocument.removeEventListener("paste", nativePaste);
    };
  });
  const disabled = busy;
  return {
    features,
    readOnly,
    canEditFavorites,
    selectionOptions,
    uiOptions,
    allowedViewModes,
    canPaste,
    canDrag,
    rootLabel,
    tabs,
    activeTabId: tabState.activeTabId,
    addTab,
    selectTab,
    closeTab,
    detachTab,
    reattachWindow,
    isDetached: windowId !== "main",
    entries,
    dirty,
    busy,
    saving,
    refreshing,
    refreshError,
    canRefresh,
    editMode,
    endEditing,
    cancelEditPermission,
    saveError,
    readFile,
    externalDownload: !!onDownloadRequest,
    previewTrigger,
    renderIcon,
    tabLocations,
    requestedLocation,
    location,
    history,
    historyIndex,
    selected,
    selectedSet,
    selectedEntries,
    anchor,
    query,
    searchText,
    searchTrigger,
    searchPending,
    searchError,
    externalSearch,
    canSort,
    setQuery,
    submitSearch,
    retrySearch,
    clearSearch,
    setSearchComposing,
    setSelected,
    view,
    setView,
    compact,
    setCompact,
    sort,
    setSort,
    expanded,
    setExpanded,
    modal,
    setModal,
    name,
    setName,
    destination,
    setDestination,
    modalError,
    setModalError,
    renamingEntryId,
    renameValue: renameSession?.value ?? "",
    renameExtension: renameSession?.extension ?? "",
    renameError: renameSession?.error ?? "",
    startRename,
    setRenameValue,
    commitRename,
    cancelRename,
    clipboard,
    detailId,
    setDetailId,
    previewId,
    setPreviewId,
    dragOver,
    setDragOver,
    externalDrag,
    setExternalDrag,
    fileInput,
    folderInput,
    searchInput,
    addressInput,
    addressPath,
    navigatePath,
    nameInput,
    workspaceRef,
    focusEntryRef,
    instanceId,
    entryId,
    mobileOpen,
    setOpenMobile,
    folder,
    special,
    currentParent,
    title,
    displayedSort,
    crumbs,
    details,
    preview,
    totalSize,
    fileCount,
    visible,
    changeView,
    changeCompact,
    navigate,
    travel,
    showModal,
    act,
    submitModal,
    saveChanges,
    refreshEntries,
    copyToClipboard,
    paste,
    openEntry,
    rowKey,
    selectEntry,
    toggleSelect,
    sortBy,
    startDrag,
    endDrag,
    allowDrop,
    drop,
    addLocalFiles,
    uploadPrompt: uploadImport.prompt,
    hasCustomContextMenu: !!getContextMenuItems,
    getCustomContextMenu: customMenu.getMenu,
    runCustomContextMenu: customMenu.run,
    customContextMenuState: customMenu.state,
    customContextMenuBusy: workspace.draft.contextMenuBusy,
    confirmCustomContextMenu: customMenu.confirm,
    cancelCustomContextMenu: customMenu.cancel,
    uploadApplying: uploadImport.applying,
    answerUploadConflict: uploadImport.answer,
    cancelUpload: uploadImport.cancel,
    acceptChosenFiles,
    cancelFilePicker,
    chooseFiles,
    download,
    disabled,
    notification,
    setNotification,
  };
}
