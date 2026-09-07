"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ExternalLink, Folder, Plus, X } from "lucide-react";
import { ContextMenu } from "./explorer-overlays";
import { mergeExplorerClasses } from "./explorer-classnames";
import { useExplorerFields } from "../state/explorer-context";
import { iconButtonClass, menuContentClass, menuItemClass } from "./explorer-controls";
import { FileIcon } from "./explorer-file-icon";
import { useExplorerDom } from "./explorer-dom-context";
import { useExplorerTheme } from "./explorer-theme";
import { hasKeyModifiers, isComposingKeyEvent } from "../model/keyboard";

type TabDrag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  button: HTMLButtonElement;
  source: HTMLElement;
  offsetX: number;
  offsetY: number;
};

type GhostMotion = {
  source: HTMLElement;
  x: number;
  y: number;
  returning: boolean;
  animation?: Animation;
};

type GhostTab = {
  id: string;
  title: string;
  width: number;
  height: number;
};

export const ExplorerTabs = memo(function ExplorerTabs() {
  const {
    tabs,
    tabLocations,
    entries,
    activeTabId,
    addTab,
    selectTab,
    closeTab,
    instanceId,
    features,
    uiOptions,
    detachTab,
    reattachWindow,
    isDetached,
  } = useExplorerFields(
    "tabs", "tabLocations", "entries", "activeTabId", "addTab", "selectTab", "closeTab",
    "instanceId", "features", "uiOptions", "detachTab", "reattachWindow", "isDetached",
  );
  const theme = useExplorerTheme();
  const { document: ownerDocument, portalContainer } = useExplorerDom();
  const bar = useRef<HTMLDivElement>(null);
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string } | "active" | null>(null);
  const drag = useRef<TabDrag | null>(null);
  const suppressedClick = useRef<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuAction = useRef(false);
  const [ghost, setGhost] = useState<GhostTab | null>(null);
  const ghostElement = useRef<HTMLDivElement>(null);
  const ghostMotion = useRef<GhostMotion | null>(null);
  const canDragTab = features.tabs && features.detachTabs;
  const canDetach = canDragTab && tabs.length > 1;

  const disposeGhost = useCallback((render = true) => {
    const motion = ghostMotion.current;
    ghostMotion.current = null;
    if (motion) {
      delete motion.source.dataset.ghostSource;
      if (motion.animation) {
        motion.animation.onfinish = null;
        motion.animation.cancel();
      }
    }
    if (ghostElement.current) ghostElement.current.style.visibility = "hidden";
    if (render) setGhost(null);
  }, []);

  const returnGhost = useCallback(() => {
    const motion = ghostMotion.current;
    if (!motion) return;
    motion.returning = true;
    const element = ghostElement.current;
    // A quick press/move/release can finish before React mounts the portal.
    if (!element) return;
    const reducedMotion = element.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!motion.source.isConnected || reducedMotion || typeof element.animate !== "function") {
      disposeGhost();
      return;
    }
    const destination = motion.source.getBoundingClientRect();
    element.dataset.returning = "true";
    motion.animation = element.animate([
      { transform: `translate3d(${motion.x}px, ${motion.y}px, 0)`, opacity: 0.82 },
      { transform: `translate3d(${destination.left}px, ${destination.top}px, 0)`, opacity: 0.25 },
    ], { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
    motion.animation.onfinish = () => {
      if (ghostMotion.current === motion) disposeGhost();
    };
  }, [disposeGhost]);

  const clearDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    delete current.button.dataset.dragging;
    if (current.button.hasPointerCapture(current.pointerId)) {
      current.button.releasePointerCapture(current.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!canDragTab) {
      clearDrag();
      // A feature change cancels the external pointer/animation session.
      disposeGhost();
    }
  }, [canDragTab, clearDrag, disposeGhost]);

  useEffect(() => () => {
    clearDrag();
    disposeGhost(false);
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
  }, [clearDrag, disposeGhost]);

  useLayoutEffect(() => {
    const motion = ghostMotion.current;
    const element = ghostElement.current;
    if (!motion || !element) return;
    element.style.visibility = "";
    delete element.dataset.returning;
    element.style.transform = `translate3d(${motion.x}px, ${motion.y}px, 0)`;
    if (motion.returning) returnGhost();
  }, [ghost, returnGhost]);

  function cancelDrag() {
    if (!drag.current) return;
    clearDrag();
    returnGhost();
  }

  function focusTab(id: string) {
    const button = tabButtons.current.get(id);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    pendingFocus.current = null;
    focusTab(request === "active" ? activeTabId : request.id);
  }, [activeTabId, tabs.length]);

  function activate(id: string) {
    selectTab(id);
    focusTab(id);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.defaultPrevented || isComposingKeyEvent(event) || hasKeyModifiers(event)) return;
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
      return;
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    activate(tabs[nextIndex].id);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    // Touch keeps native horizontal scrolling and the context menu's long press.
    if (event.pointerType === "touch" || event.button !== 0 || event.isPrimary === false) return;
    clearDrag();
    disposeGhost();
    const source = event.currentTarget.closest<HTMLElement>("[data-explorer-tab]") ?? event.currentTarget;
    const bounds = source.getBoundingClientRect();
    drag.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      button: event.currentTarget,
      source,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateGhost(current: TabDrag, event: PointerEvent<HTMLButtonElement>) {
    if (!current.moved) {
      current.moved = true;
      current.button.dataset.dragging = "true";
      current.source.dataset.ghostSource = "true";
      const bounds = current.source.getBoundingClientRect();
      ghostMotion.current = { source: current.source, x: 0, y: 0, returning: false };
      setGhost({
        id: current.id,
        title: tabs.find((tab) => tab.id === current.id)?.title ?? "",
        width: bounds.width,
        height: bounds.height,
      });
    }
    const motion = ghostMotion.current;
    if (!motion) return;
    motion.x = event.clientX - current.offsetX;
    motion.y = event.clientY - current.offsetY;
    if (ghostElement.current) ghostElement.current.style.transform = `translate3d(${motion.x}px, ${motion.y}px, 0)`;
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 8) {
      updateGhost(current, event);
      event.preventDefault();
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 8;
    const bounds = bar.current?.getBoundingClientRect();
    const outside = bounds && (
      event.clientX < bounds.left - 32 || event.clientX > bounds.right + 32 ||
      event.clientY < bounds.top - 32 || event.clientY > bounds.bottom + 32
    );
    if (moved) updateGhost(current, event);
    clearDrag();
    if (!moved) return;
    event.preventDefault();
    suppressedClick.current = current.id;
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      suppressedClick.current = null;
      clickTimer.current = null;
    }, 0);
    const detached = canDetach && outside && detachTab(current.id, {
      left: event.screenX - current.offsetX,
      top: event.screenY - current.offsetY,
      tabAnchor: {
        screenX: event.screenX,
        screenY: event.screenY,
        offsetX: current.offsetX,
        offsetY: current.offsetY,
      },
    });
    if (detached) disposeGhost();
    else returnGhost();
  }

  if (!features.tabs) return null;

  return (
    <>
    <div ref={bar} className="lxe:flex lxe:min-w-0 lxe:flex-1 lxe:items-end lxe:gap-1">
      <div
        role="tablist"
        aria-label="開いているフォルダ"
        aria-orientation="horizontal"
        className="lxe:flex lxe:min-w-0 lxe:items-end lxe:gap-1 lxe:overflow-x-auto lxe:overflow-y-hidden lxe:[scrollbar-width:none]"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const folder = entries.find(
            (entry) => entry.kind === "folder" && entry.id === tabLocations[tab.id],
          );
          const defaultIcon = (
            <Folder
              size={17}
              className="lxe:shrink-0 lxe:text-[var(--explorer-folder)]"
              style={{ fill: "none" }}
            />
          );
          const tabContent = (
            <div
              key={tab.id}
              role="presentation"
              data-explorer-tab={tab.id}
              className={`lxe:flex lxe:h-8 lxe:w-[15ch] lxe:shrink-0 lxe:items-center lxe:rounded-t-md lxe:border lxe:border-b-0 lxe:text-[13px] lxe:data-[ghost-source=true]:opacity-25 ${active ? "lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)]" : "lxe:border-transparent lxe:text-[var(--explorer-muted)] lxe:hover:bg-[var(--explorer-panel)]"}`}
            >
              <button
                ref={(button) => {
                  if (button) tabButtons.current.set(tab.id, button);
                  else tabButtons.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                id={`${instanceId}-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`${instanceId}-panel`}
                tabIndex={active ? 0 : -1}
                title={tab.title}
                className="lxe:flex lxe:h-full lxe:min-w-0 lxe:flex-1 lxe:cursor-pointer lxe:select-none lxe:items-center lxe:gap-2 lxe:rounded-t-md lxe:px-3 lxe:text-left lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)] lxe:data-[dragging=true]:cursor-grabbing"
                onClick={(event) => {
                  if (suppressedClick.current === tab.id) {
                    event.preventDefault();
                    event.stopPropagation();
                    suppressedClick.current = null;
                    return;
                  }
                  activate(tab.id);
                }}
                onKeyDown={(event) => onTabKeyDown(event, tab.id)}
                onPointerDown={canDragTab ? (event) => onPointerDown(event, tab.id) : undefined}
                onPointerMove={canDragTab ? onPointerMove : undefined}
                onPointerUp={canDragTab ? onPointerUp : undefined}
                onPointerCancel={canDragTab ? cancelDrag : undefined}
                onLostPointerCapture={canDragTab ? cancelDrag : undefined}
              >
                {folder ? (
                  <FileIcon
                    entry={folder}
                    location="tab"
                    selected={active}
                    className="lxe:size-[17px]"
                    defaultIcon={defaultIcon}
                  />
                ) : defaultIcon}
                <span className="lxe:truncate">{tab.title}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  tabIndex={active ? 0 : -1}
                  aria-label={`${tab.title}のタブを閉じる`}
                  title="タブを閉じる"
                  className={mergeExplorerClasses(iconButtonClass, "lxe:mr-1 lxe:size-6")}
                  onClick={() => {
                    pendingFocus.current = "active";
                    closeTab(tab.id);
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
          if (!features.detachTabs || !uiOptions.contextMenu || (!isDetached && tabs.length <= 1)) return tabContent;
          return (
            <ContextMenu.Root key={tab.id}>
              <ContextMenu.Trigger asChild>{tabContent}</ContextMenu.Trigger>
              <ContextMenu.Portal container={portalContainer}>
                <ContextMenu.Content
                  data-explorer-portal={instanceId}
                  style={theme}
                  className={menuContentClass}
                  collisionPadding={8}
                  onCloseAutoFocus={(event) => {
                    if (!menuAction.current) return;
                    menuAction.current = false;
                    event.preventDefault();
                    // A blocked popup leaves its source tab available for retry.
                    const source = tabButtons.current.get(tab.id);
                    if (source?.isConnected) source.focus({ preventScroll: true });
                  }}
                >
                  {canDetach && (
                    <ContextMenu.Item
                      className={menuItemClass}
                      onSelect={() => {
                        menuAction.current = true;
                        detachTab(tab.id);
                      }}
                    >
                      <ExternalLink />
                      別ウィンドウで開く
                    </ContextMenu.Item>
                  )}
                  {isDetached && (
                    <ContextMenu.Item
                      className={menuItemClass}
                      onSelect={() => {
                        menuAction.current = true;
                        reattachWindow();
                      }}
                    >
                      <ArrowLeft />
                      元のウィンドウに戻す
                    </ContextMenu.Item>
                  )}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="新しいタブを開く"
        title="新しいタブを開く"
        className={mergeExplorerClasses(
          iconButtonClass,
          "lxe:mb-0.5 lxe:size-7 lxe:transition-colors lxe:hover:bg-[var(--explorer-border)] lxe:motion-reduce:transition-none",
        )}
        onClick={() => {
          const id = addTab();
          if (id) pendingFocus.current = { id };
        }}
      >
        <Plus size={16} />
      </button>
    </div>
    {canDragTab && ghost && (portalContainer ?? ownerDocument?.body) && createPortal(
      <div
        ref={ghostElement}
        data-explorer-tab-ghost={instanceId}
        data-likex-explorer=""
        aria-hidden="true"
        className="lxe:pointer-events-none lxe:fixed lxe:top-0 lxe:left-0 lxe:z-[100] lxe:flex lxe:items-center lxe:gap-2 lxe:rounded-md lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)] lxe:px-3 lxe:text-[13px] lxe:leading-normal lxe:text-[var(--explorer-foreground)] lxe:shadow-[0_12px_28px_#0f274540]"
        style={{ ...theme, width: ghost.width, height: ghost.height, opacity: 0.82, willChange: "transform" }}
      >
        {(() => {
          const folder = entries.find((entry) => entry.kind === "folder" && entry.id === tabLocations[ghost.id]);
          const defaultIcon = <Folder size={17} className="lxe:shrink-0 lxe:text-[var(--explorer-folder)]" style={{ fill: "none" }} />;
          return folder ? <FileIcon entry={folder} location="tab" selected={ghost.id === activeTabId} className="lxe:size-[17px]" defaultIcon={defaultIcon} /> : defaultIcon;
        })()}
        <span className="lxe:truncate">{ghost.title}</span>
      </div>,
      (portalContainer ?? ownerDocument?.body)!,
    )}
    </>
  );
});
