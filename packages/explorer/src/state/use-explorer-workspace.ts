"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExplorerProps } from "../props";
import { resolveExplorerOptions } from "../model/config";
import { resolveInitialExplorerLocation } from "../model/initial-location";
import { dispatchExplorerEvent } from "../model/events";
import { useExplorerDraft } from "./use-explorer-draft";
import { useExplorerTabs } from "./use-explorer-tabs";
import { prepareDetachedDocument } from "./detached-document";
import { calcDetachedWindowPosition, type WindowPosition } from "../model/window-placement";
export type { WindowPosition } from "../model/window-placement";
import type { ExplorerClipboardState } from "./view-state";
import { createMediaCache } from "./media-cache";
import { createDownloadManager } from "./download-manager";
import { createUnsavedChangesGuard } from "../model/unsaved-changes";
import { useExplorerNotifications } from "./use-explorer-notifications";

type DetachedView = {
  id: string; window: Window; container: HTMLElement; dispose: () => void; position?: WindowPosition;
  sourceWindowId: string; phase: "opening" | "ready"; openedAt: number; onFailure?: () => void;
};

function closeDetachedView(view: DetachedView) {
  view.dispose();
  try {
    if (!view.window.closed) view.window.close();
  } catch {
    // A navigated window may no longer allow access; the shared draft is unaffected.
  }
}

/** One workspace owns all file data, saves, clipboard and tab identities. */
export function useExplorerWorkspace(props: ExplorerProps) {
  const notifications = useExplorerNotifications();
  const { notify, dismiss, clear } = notifications;
  useImperativeHandle(props.ref, () => ({ notify, dismissNotification: dismiss, clearNotifications: clear }), [notify, dismiss, clear]);
  const draft = useExplorerDraft(props);
  const [unsavedChangesGuard] = useState(createUnsavedChangesGuard);
  useLayoutEffect(() => {
    unsavedChangesGuard.setActive(props.warnOnUnsavedChanges !== false && draft.dirty);
  }, [unsavedChangesGuard, props.warnOnUnsavedChanges, draft.dirty]);
  useLayoutEffect(() => unsavedChangesGuard.register(typeof window === "undefined" ? null : window), [unsavedChangesGuard]);
  const [downloads] = useState(createDownloadManager);
  useLayoutEffect(() => () => downloads.cancelAll("unmounted"), [downloads]);
  const pendingImports = useRef(new Set<AbortController>());
  const cancelImports = useCallback(() => {
    for (const controller of pendingImports.current) controller.abort();
    pendingImports.current.clear();
  }, []);
  const registerImport = useCallback((controller: AbortController) => {
    pendingImports.current.add(controller);
    return () => { pendingImports.current.delete(controller); };
  }, []);
  useEffect(() => cancelImports, [cancelImports]);
  const saveDraft = draft.save, refreshDraft = draft.refresh, discardDraft = draft.discard, endDraftEdit = draft.endEdit;
  const canMutate = draft.canMutate;
  const save = useCallback((windowId?: string) => {
    if (!canMutate()) return Promise.resolve(false);
    cancelImports();
    return saveDraft(windowId);
  }, [cancelImports, saveDraft, canMutate]);
  const { canRefresh, saving, refreshing, getEditState } = draft;
  const refresh = useCallback(() => {
    if (!canMutate() || !canRefresh || saving || refreshing || getEditState().mode === "requesting")
      return Promise.resolve(false);
    cancelImports();
    return refreshDraft();
  }, [canRefresh, saving, refreshing, getEditState, cancelImports, refreshDraft, canMutate]);
  const discard = useCallback(() => {
    if (!canMutate()) return;
    cancelImports();
    discardDraft();
  }, [cancelImports, discardDraft, canMutate]);
  const endEdit = useCallback(() => {
    if (!canMutate()) return false;
    cancelImports();
    return endDraftEdit();
  }, [cancelImports, endDraftEdit, canMutate]);
  const [mediaCache] = useState(createMediaCache);
  useEffect(() => () => mediaCache.dispose(), [mediaCache]);
  useEffect(() => {
    if (draft.contentRevision > 0) mediaCache.invalidateExisting(draft.contentRevision);
  }, [draft.contentRevision, mediaCache]);
  const options = useMemo(() => resolveExplorerOptions({
    readOnly: draft.readOnly,
    features: props.features, selection: props.selection, ui: props.ui, view: props.view,
  }), [draft.readOnly, props.features, props.selection, props.ui, props.view]);
  useLayoutEffect(() => {
    if (!options.features.download) downloads.cancelAll("disabled");
  }, [downloads, options.features.download]);
  const [starts] = useState(() => {
    const common = { initialEntries: draft.entries, defaultPath: props.defaultPath, rootLabel: props.rootLabel };
    const initial = resolveInitialExplorerLocation({ ...common, initialPath: props.initialPath, selectedFile: props.selectedFile });
    return {
      defaultStart: resolveInitialExplorerLocation(common),
      initialStart: { ...initial, selectedIds: initial.selectedFileId && options.selection.mode !== "none" ? [initial.selectedFileId] : [] },
      previewFileId: props.selectedFileMode === "preview" ? initial.selectedFileId : null,
    };
  });
  const { defaultStart, initialStart } = starts;
  const tabs = useExplorerTabs(options.view.defaultMode, initialStart, false, defaultStart);
  const [takeInitialPreview] = useState(() => {
    const firstTabId = tabs.activeTabId;
    let pending = starts.previewFileId;
    // The workspace survives popup close/reopen. Claim before invoking host code
    // so remounts, StrictMode and reentrant callbacks cannot replay the request.
    return (tabId: string) => {
      if (tabId !== firstTabId) return null;
      const id = pending;
      pending = null;
      return id;
    };
  });
  const { getWindowTabIds, restoreWindow: returnWindowTabs, closeWindow: closeWindowTabs } = tabs;
  const [clipboard, updateClipboard] = useState<ExplorerClipboardState>(null);
  const clipboardRef = useRef<{ value: ExplorerClipboardState; revision: number }>({ value: null, revision: draft.editRevision });
  const getEditRevision = draft.getEditRevision;
  const setClipboard = useCallback((value: ExplorerClipboardState) => {
    clipboardRef.current = { value, revision: getEditRevision() };
    updateClipboard(value);
  }, [getEditRevision]);
  const getClipboard = useCallback(() => clipboardRef.current.revision === getEditRevision()
    ? clipboardRef.current.value : null, [getEditRevision]);
  const [clipboardRevision, setClipboardRevision] = useState(draft.editRevision);
  const editEnded = clipboardRevision !== draft.editRevision;
  if (editEnded) setClipboardRevision(draft.editRevision);
  // Reset local transfer state before rendering panes under the new policy.
  if ((draft.readOnly || editEnded) && clipboard !== null) updateClipboard(null);
  const draggedIds = useRef<string[] | null>(null);
  const importsRevision = useRef(draft.editRevision);
  useLayoutEffect(() => {
    const ended = importsRevision.current !== draft.editRevision;
    importsRevision.current = draft.editRevision;
    if (!draft.readOnly && !ended) return;
    clipboardRef.current.value = null;
    cancelImports();
    draggedIds.current = null;
  }, [draft.readOnly, draft.editRevision, cancelImports]);
  const workspaceId = useId();
  const nextWindow = useRef(0);
  const hostDocument = useRef<Document | null>(null);
  const placedWindows = useRef(new Set<string>());
  const registry = useRef(new Map<string, DetachedView>());
  const closingBatch = useRef(0);
  const [windows, setWindows] = useState<DetachedView[]>([]);
  const observer = useRef(props.onEvent);
  useLayoutEffect(() => { observer.current = props.onEvent; }, [props.onEvent]);
  const finishWindow = useCallback((id: string, action: "check" | "reattach" | "close") => {
    const view = registry.current.get(id);
    if (!view) return;
    if (action === "check") {
      if (view.phase === "ready") return;
      let unavailable = false;
      try {
        unavailable = view.window.closed || view.window.document !== view.container.ownerDocument || !view.container.isConnected;
        const root = view.container.querySelector<HTMLElement>("[data-explorer-root]");
        if (!unavailable && root?.isConnected && view.window.innerWidth > 0 && view.window.innerHeight > 0 &&
          view.window.document.visibilityState === "visible" && view.window.document.readyState !== "loading") {
          view.phase = "ready";
          dispatchExplorerEvent(observer.current, { type: "window", action: "detach", windowId: id,
            sourceWindowId: view.sourceWindowId, tabIds: getWindowTabIds(id) });
          return;
        }
      } catch {
        unavailable = true;
      }
      // Some hosts return a WindowProxy before creating a visible native window.
      if (!unavailable && Date.now() - view.openedAt < 5000) return;
    }
    const tabIds = getWindowTabIds(id);
    const failedOpening = view.phase === "opening" && action !== "reattach";
    registry.current.delete(id);
    if (!registry.current.size) hostDocument.current = null;
    placedWindows.current.delete(id);
    if (failedOpening) returnWindowTabs(id, registry.current.has(view.sourceWindowId) ? view.sourceWindowId : "main");
    else if (action === "reattach") returnWindowTabs(id);
    else closeWindowTabs(id);
    if (!closingBatch.current) setWindows([...registry.current.values()]);
    closeDetachedView(view);
    if (failedOpening) {
      dispatchExplorerEvent(observer.current, { type: "window", action: "blocked", windowId: id,
        sourceWindowId: view.sourceWindowId, tabIds, message: "別ウィンドウを表示できなかったため、タブを復元しました" });
      view.onFailure?.();
    } else {
      dispatchExplorerEvent(observer.current, { type: "window", action: action === "reattach" ? "reattach" : "close", windowId: id, tabIds });
    }
  }, [getWindowTabIds, returnWindowTabs, closeWindowTabs]);
  const reattachWindow = useCallback((id: string) => finishWindow(id, "reattach"), [finishWindow]);
  const closeWindow = useCallback((id: string) => finishWindow(id, "close"), [finishWindow]);
  const closeDetachedWindows = useCallback(() => {
    if (!registry.current.size) return;
    closingBatch.current++;
    try {
      tabs.batch(() => { for (const id of [...registry.current.keys()]) closeWindow(id); });
    } finally {
      closingBatch.current--;
      if (!closingBatch.current) setWindows([...registry.current.values()]);
    }
  }, [tabs, closeWindow]);
  const detachTab = useCallback((tabId: string, ownerDocument: Document | null, position?: WindowPosition, sourceWindowId = "main", onFailure?: () => void) => {
    const sourceTabIds = getWindowTabIds(sourceWindowId);
    if (!options.features.tabs || !options.features.detachTabs || sourceTabIds.length <= 1 || !sourceTabIds.includes(tabId) ||
      (sourceWindowId !== "main" && !registry.current.has(sourceWindowId))) return false;
    if (sourceWindowId === "main" && ownerDocument) hostDocument.current = ownerDocument;
    const id = `${workspaceId}-window-${++nextWindow.current}`;
    let popup: Window | null = null;
    let dispose: (() => void) | undefined;
    try {
      const source = ownerDocument?.defaultView;
      const initialPosition = position ?? (source && Number.isFinite(source.screenX) && Number.isFinite(source.screenY)
        ? { left: source.screenX + 40, top: source.screenY + 40 } : undefined);
      const placement = initialPosition && Number.isFinite(initialPosition.left) && Number.isFinite(initialPosition.top)
        ? `,left=${Math.round(initialPosition.left)},top=${Math.round(initialPosition.top)}` : "";
      // Activation belongs to the window receiving the gesture, not the shared
      // workspace's main window. Keep this call synchronous with that gesture.
      popup = source?.open("about:blank", id, `popup=yes,resizable=yes,scrollbars=yes,width=1100,height=760${placement}`) ?? null;
      if (!popup || !ownerDocument) throw new Error("別ウィンドウを開けませんでした");
      // Keep our direct reference for React portals, while disowning the opener.
      // The host browser still controls native window stacking and tab placement.
      popup.opener = null;
      const prepared = prepareDetachedDocument(hostDocument.current ?? ownerDocument, popup.document);
      const releaseWarning = unsavedChangesGuard.register(popup);
      dispose = () => { releaseWarning(); prepared.dispose(); };
      if (!tabs.detachTab(tabId, id, sourceWindowId)) throw new Error("タブが見つかりません");
      const view: DetachedView = { id, window: popup, container: prepared.container, dispose, position,
        sourceWindowId, phase: "opening", openedAt: Date.now(), onFailure };
      registry.current.set(id, view);
      setWindows([...registry.current.values()]);
      try { popup.focus(); } catch { /* Some browsers deny programmatic focus. */ }
      return true;
    } catch {
      dispose?.();
      try { popup?.close(); } catch { /* Report the original opening failure. */ }
      if (!registry.current.size) hostDocument.current = null;
      dispatchExplorerEvent(observer.current, { type: "window", action: "blocked", windowId: id, sourceWindowId, tabIds: [tabId], message: "別ウィンドウを開けませんでした" });
      return false;
    }
  }, [options.features.tabs, options.features.detachTabs, getWindowTabIds, tabs, workspaceId, unsavedChangesGuard]);
  useLayoutEffect(() => {
    // Child portals have committed their DOM before this parent layout effect.
    for (const view of windows) finishWindow(view.id, "check");
    const host = hostDocument.current?.defaultView;
    if (!host?.requestAnimationFrame) return;
    const frames = new Set<number>();
    const cleanups: (() => void)[] = [];
    let cancelled = false;
    for (const view of windows) {
      const anchor = view.position?.tabAnchor;
      if (!anchor || placedWindows.current.has(view.id)) continue;
      let attempts = 0;
      function align() {
        if (cancelled || !registry.current.has(view.id) || placedWindows.current.has(view.id)) return;
        try {
          const tab = view.container.querySelector<HTMLElement>("[data-explorer-tab]");
          const position = tab && calcDetachedWindowPosition(view.window, tab.getBoundingClientRect(), anchor!);
          if (position && typeof view.window.moveTo === "function") {
            view.window.moveTo(position.left, position.top);
            placedWindows.current.add(view.id);
            return;
          }
        } catch {
          // A host may reject moving a window. Its original requested position remains.
          return;
        }
        if (++attempts < 5) frames.add(host!.requestAnimationFrame(align));
      }
      frames.add(host.requestAnimationFrame(align));
      // Embedded browsers can report a zero viewport until the native view appears.
      // Retry on its first resize, and stop observing after the opening settles.
      view.window.addEventListener?.("resize", align);
      cleanups.push(() => view.window.removeEventListener?.("resize", align));
      if (typeof host.setTimeout === "function") {
        const retry = host.setTimeout(align, 300);
        const stop = host.setTimeout(() => view.window.removeEventListener?.("resize", align), 2000);
        cleanups.push(() => { host.clearTimeout(retry); host.clearTimeout(stop); });
      }
    }
    return () => {
      cancelled = true;
      for (const frame of frames) host.cancelAnimationFrame(frame);
      for (const cleanup of cleanups) cleanup();
    };
  }, [windows, finishWindow]);
  useEffect(() => {
    if (!windows.length) return;
    const timer = setInterval(() => {
      for (const view of registry.current.values()) {
        if (view.phase === "opening") { finishWindow(view.id, "check"); continue; }
        let unavailable = false;
        try {
          unavailable = view.window.closed ||
            view.window.document !== view.container.ownerDocument ||
            !view.container.isConnected;
        } catch {
          // Cross-origin navigation makes window.document inaccessible.
          unavailable = true;
        }
        if (unavailable) closeWindow(view.id);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [windows.length, closeWindow, finishWindow]);
  useEffect(() => {
    if (!options.features.tabs || !options.features.detachTabs) {
      closeDetachedWindows();
    }
  }, [options.features.tabs, options.features.detachTabs, closeDetachedWindows]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function closeAllWindows() {
      // Close only the child views; BFCache keeps the shared draft available.
      closeDetachedWindows();
    }
    window.addEventListener("pagehide", closeAllWindows);
    return () => window.removeEventListener("pagehide", closeAllWindows);
  }, [closeDetachedWindows]);
  useEffect(() => {
    const views = registry.current;
    return () => {
      // Unmount has no remaining UI to restore and must not schedule state.
      for (const view of views.values()) closeDetachedView(view);
      views.clear();
      hostDocument.current = null;
    };
  }, []);
  return { draft: { ...draft, save, refresh, discard, endEdit }, registerImport, tabs, defaultStart, initialStart, takeInitialPreview, clipboard, setClipboard, getClipboard, draggedIds, workspaceId, windows, detachTab, reattachWindow, closeDetachedWindows, mediaCache, downloads, unsavedChangesGuard, notifications };
}

export type ExplorerWorkspace = ReturnType<typeof useExplorerWorkspace>;
