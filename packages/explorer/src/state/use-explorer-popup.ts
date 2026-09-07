"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerPopupOptions } from "../props";
import { dispatchExplorerEvent, type ExplorerEventHandler } from "../model/events";
import { prepareDetachedDocument } from "./detached-document";
import type { UnsavedChangesGuard } from "../model/unsaved-changes";

type PopupView = { window: Window; container: HTMLElement; document: Document };
type PopupSession = PopupView & {
  id: string;
  phase: "opening" | "ready";
  openedAt: number;
  dispose: () => void;
  cleanups: (() => void)[];
};
type PopupState = { view: PopupView | null; isOpen: boolean; isOpening: boolean; error: string | null };
const closedState: PopupState = { view: null, isOpen: false, isOpening: false, error: null };

function notify(callback: (() => void) | undefined) {
  try { void Promise.resolve(callback?.()).catch(() => {}); } catch { /* Notifications do not control window lifetime. */ }
}

/** Owns the popup host only; its workspace remains mounted in ExplorerPopup. */
export function useExplorerPopupWindow(
  options?: ExplorerPopupOptions,
  onOpenChange?: (open: boolean) => void,
  onBeforeClose?: () => void,
  onEvent?: ExplorerEventHandler,
  unsavedChangesGuard?: UnsavedChangesGuard,
) {
  const id = `explorer-popup-${useId()}`;
  const latest = useRef({ options, onOpenChange, onBeforeClose, onEvent, unsavedChangesGuard });
  useLayoutEffect(() => { latest.current = { options, onOpenChange, onBeforeClose, onEvent, unsavedChangesGuard }; },
    [options, onOpenChange, onBeforeClose, onEvent, unsavedChangesGuard]);
  const session = useRef<PopupSession | null>(null);
  const mounted = useRef(true);
  const [state, setState] = useState<PopupState>(closedState);

  const finish = useCallback((view: PopupSession, error: string | null = null, update = true) => {
    if (session.current !== view) return;
    session.current = null;
    for (const cleanup of view.cleanups) cleanup();
    view.dispose();
    if (update && mounted.current) setState({ ...closedState, error });
    // Explicit closure updates the retained workspace; on unmount its own
    // cleanup closes descendants without scheduling tab or React state changes.
    if (update) notify(latest.current.onBeforeClose);
    try { if (!view.window.closed) view.window.close(); } catch { /* A navigated host may deny window access. */ }
    if (view.phase === "ready") notify(() => latest.current.onOpenChange?.(false));
    if (error) dispatchExplorerEvent(latest.current.onEvent, {
      type: "window", action: "blocked", windowId: view.id, sourceWindowId: "main", tabIds: [], message: error,
    });
  }, []);

  const check = useCallback((view: PopupSession) => {
    if (session.current !== view) return;
    let unavailable = false;
    try {
      unavailable = view.window.closed || view.window.document !== view.document || !view.container.isConnected;
      if (!unavailable && view.phase === "opening") {
        const root = view.container.querySelector<HTMLElement>("[data-explorer-root]");
        if (root?.isConnected && view.window.innerWidth > 0 && view.window.innerHeight > 0 &&
          view.document.visibilityState === "visible" && view.document.readyState !== "loading") {
          view.phase = "ready";
          if (mounted.current) setState(current => ({ ...current, isOpen: true, isOpening: false }));
          notify(() => latest.current.onOpenChange?.(true));
          return;
        }
      }
    } catch {
      unavailable = true;
    }
    if (unavailable || (view.phase === "opening" && Date.now() - view.openedAt >= 5000)) {
      finish(view, view.phase === "opening" ? "別ウィンドウを表示できませんでした" : null);
    }
  }, [finish]);

  const open = useCallback((event?: { currentTarget: EventTarget | null }) => {
    if (!mounted.current) return false;
    const existing = session.current;
    if (existing) {
      check(existing);
      if (session.current === existing) {
        try { existing.window.focus(); } catch { /* Focusing an existing host is optional. */ }
        return true;
      }
    }
    const sourceDocument = (event?.currentTarget as { ownerDocument?: Document } | null | undefined)?.ownerDocument ??
      (typeof document !== "undefined" ? document : null);
    const source = sourceDocument?.defaultView;
    let popup: Window | null = null;
    let dispose: (() => void) | undefined;
    try {
      const settings = latest.current.options;
      const width = settings?.width && Number.isFinite(settings.width) && settings.width > 0 ? Math.max(1, Math.round(settings.width)) : 1100;
      const height = settings?.height && Number.isFinite(settings.height) && settings.height > 0 ? Math.max(1, Math.round(settings.height)) : 760;
      const left = settings?.left ?? (source && Number.isFinite(source.screenX) ? source.screenX + 40 : undefined);
      const top = settings?.top ?? (source && Number.isFinite(source.screenY) ? source.screenY + 40 : undefined);
      const placement = `${Number.isFinite(left) ? `,left=${Math.round(left!)}` : ""}${Number.isFinite(top) ? `,top=${Math.round(top!)}` : ""}`;
      // Preserve the activation of the actual button's browsing context.
      popup = source?.open("about:blank", id, `popup=yes,resizable=yes,scrollbars=yes,width=${width},height=${height}${placement}`) ?? null;
      if (!popup || !sourceDocument) throw new Error("Popup unavailable");
      popup.opener = null;
      const targetDocument = popup.document;
      const prepared = prepareDetachedDocument(sourceDocument, targetDocument);
      dispose = prepared.dispose;
      const view: PopupSession = { id, window: popup, container: prepared.container, document: targetDocument,
        phase: "opening", openedAt: Date.now(), dispose, cleanups: [] };
      session.current = view;
      const unregisterGuard = latest.current.unsavedChangesGuard?.register(popup);
      if (unregisterGuard) view.cleanups.push(unregisterGuard);
      const timer = setInterval(() => check(view), 300);
      view.cleanups.push(() => clearInterval(timer));
      const onSourcePageHide = () => finish(view);
      source?.addEventListener?.("pagehide", onSourcePageHide);
      view.cleanups.push(() => source?.removeEventListener?.("pagehide", onSourcePageHide));
      setState({ view, isOpen: false, isOpening: true, error: null });
      try { popup.focus(); } catch { /* A browser may decline the initial focus request. */ }
      return true;
    } catch {
      const error = "別ウィンドウを開けませんでした。ブラウザのポップアップ設定を確認してください";
      const active = session.current;
      if (active?.window === popup) {
        finish(active, error);
        return false;
      }
      dispose?.();
      try { popup?.close(); } catch { /* Preserve the opening failure. */ }
      setState({ ...closedState, error });
      dispatchExplorerEvent(latest.current.onEvent, {
        type: "window", action: "blocked", windowId: id, sourceWindowId: "main", tabIds: [], message: error,
      });
      return false;
    }
  }, [check, finish, id]);

  const close = useCallback(() => {
    const view = session.current;
    if (!view || latest.current.unsavedChangesGuard?.confirmClose(view.window) === false) return;
    finish(view);
  }, [finish]);

  useLayoutEffect(() => {
    // The portal's Explorer DOM has committed before this parent effect runs.
    if (session.current) check(session.current);
  }, [state.view, check]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (session.current) finish(session.current, null, false);
    };
  }, [finish]);

  return { ...state, open, close };
}
