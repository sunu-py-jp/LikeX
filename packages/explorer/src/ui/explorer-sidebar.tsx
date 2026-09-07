"use client";

import { matchesExplorerShortcut } from "../model/keyboard";

import { memo, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { mergeExplorerClasses } from "./explorer-classnames";
import {
  ChevronRight,
  Clock3,
  Files,
  FolderOpen,
  HardDrive,
  Star,
  X,
} from "lucide-react";
import { useExplorerFields } from "../state/explorer-context";
import { FAVORITES, RECENT } from "../state/view-state";
import { formatSize } from "../model/entries";
import { getEntryIndex } from "../model/entry-index";
import { folderNameOrder } from "../model/text";
import { iconButtonClass } from "./explorer-controls";
import { FileIcon } from "./explorer-file-icon";
import {
  ExplorerSidebarResizer,
  useExplorerSidebarResize,
} from "./explorer-sidebar-resizer";

export const ExplorerSidebar = memo(function ExplorerSidebar() {
  const {
    entries,
    expanded,
    setExpanded,
    location,
    rootLabel,
    dragOver,
    allowDrop,
    setDragOver,
    drop,
    navigate,
    fileCount,
    totalSize,
    mobileOpen,
    setOpenMobile,
    instanceId,
    workspaceRef,
    features,
  } = useExplorerFields("entries", "expanded", "setExpanded", "location", "rootLabel", "dragOver", "allowDrop", "setDragOver", "drop", "navigate", "fileCount", "totalSize", "mobileOpen", "setOpenMobile", "instanceId", "workspaceRef", "features");

  const asideRef = useRef<HTMLElement>(null);
  const sidebarResize = useExplorerSidebarResize(
    features.resizeSidebar,
    workspaceRef,
  );
  useEffect(() => {
    if (mobileOpen)
      asideRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [mobileOpen]);

  function closeNavigation() {
    setOpenMobile(false);
    workspaceRef.current
      ?.querySelector<HTMLButtonElement>("[data-explorer-navigation-trigger]")
      ?.focus();
  }

  function goTo(id: string | symbol) {
    navigate(id);
    if (mobileOpen) workspaceRef.current?.focus();
  }

  const index = getEntryIndex(entries);
  const foldersByParent = useMemo(() => new Map([...index.folderChildrenByParent].map(([parent, folders]) =>
    [parent, [...folders].sort((a, b) => folderNameOrder.compare(a.name, b.name))])), [index]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rootOpen = expandedSet.has("root");
  const rootHasChildren = (foldersByParent.get("root")?.length ?? 0) > 0;

  function tree(parent: string, depth = 0): ReactNode {
    if (depth > 20) return null;
    return (foldersByParent.get(parent) ?? [])
      .map((entry) => {
        const open = expandedSet.has(entry.id);
        const hasChildren = foldersByParent.has(entry.id);
        return (
          <li key={entry.id}>
            <div
              className={`lxe:flex lxe:h-8 lxe:min-w-0 lxe:items-center lxe:gap-0.5 lxe:pr-2 lxe:hover:bg-[var(--explorer-hover)] ${location === entry.id ? "lxe:bg-[var(--explorer-selection)]" : ""} ${dragOver === entry.id ? "lxe:bg-[var(--explorer-selection)] lxe:outline-1 lxe:-outline-offset-1 lxe:outline-[var(--explorer-accent)]" : ""}`}
              style={{ paddingLeft: 24 + depth * 14 }}
              onDragOver={(event) => allowDrop(event, entry.id)}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => void drop(event, entry.id)}
            >
              <button
                type="button"
                aria-label={`${entry.name}を${open ? "折りたたむ" : "展開"}`}
                aria-expanded={hasChildren ? open : undefined}
                tabIndex={hasChildren ? 0 : -1}
                className={mergeExplorerClasses(
                  iconButtonClass,
                  "lxe:h-7 lxe:w-5 lxe:text-[var(--explorer-muted)]",
                  !hasChildren && "lxe:invisible",
                )}
                onClick={() =>
                  setExpanded((old) =>
                    open
                      ? old.filter((id) => id !== entry.id)
                      : [...old, entry.id],
                  )
                }
              >
                <ChevronRight size={13} className={open ? "lxe:rotate-90" : ""} />
              </button>
              <button
                type="button"
                className="lxe:flex lxe:h-full lxe:min-w-0 lxe:flex-1 lxe:items-center lxe:gap-2 lxe:rounded-sm lxe:text-left lxe:text-[13px] lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]"
                aria-current={location === entry.id ? "page" : undefined}
                onClick={() => goTo(entry.id)}
              >
                <FileIcon
                  entry={entry}
                  location="tree"
                  selected={location === entry.id}
                  expanded={open}
                  className="lxe:size-4"
                />
                <span className="lxe:truncate">{entry.name}</span>
              </button>
            </div>
            {open && hasChildren && <ul>{tree(entry.id, depth + 1)}</ul>}
          </li>
        );
      });
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="lxe:absolute lxe:inset-0 lxe:z-20 lxe:cursor-default lxe:bg-black/20 lxe:@[720px]/explorer:hidden"
          aria-label="フォルダのナビゲーションを閉じる"
          onClick={closeNavigation}
        />
      )}
      <aside
        ref={asideRef}
        id={`${instanceId}-navigation`}
        aria-label="エクスプローラーのナビゲーション"
        style={{ "--explorer-sidebar-width": `${sidebarResize.width}px` } as CSSProperties}
        className={`lxe:absolute lxe:inset-y-0 lxe:left-0 lxe:z-30 lxe:w-52 lxe:max-w-full lxe:shrink-0 lxe:flex-col lxe:border-r lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)] lxe:text-[var(--explorer-foreground)] lxe:shadow-lg lxe:@[720px]/explorer:static lxe:@[720px]/explorer:z-auto lxe:@[720px]/explorer:flex lxe:@[720px]/explorer:w-[var(--explorer-sidebar-width)] lxe:@[720px]/explorer:max-w-[calc(100cqw-326px)] lxe:@[720px]/explorer:shadow-none ${mobileOpen ? "lxe:flex" : "lxe:hidden"}`}
        onKeyDown={(event) => {
          if (!event.defaultPrevented && matchesExplorerShortcut(event, "clear") && mobileOpen) {
            event.stopPropagation();
            closeNavigation();
          }
        }}
      >
        <div className="lxe:flex lxe:h-10 lxe:shrink-0 lxe:items-center lxe:gap-2 lxe:border-b lxe:border-[var(--explorer-border)] lxe:px-4 lxe:text-[13px] lxe:text-[var(--explorer-muted)] lxe:@[720px]/explorer:hidden">
          <FolderOpen
            size={17}
            className="lxe:shrink-0 lxe:text-[var(--explorer-folder)]"
          />
          <span>エクスプローラー</span>
          <button
            type="button"
            className={mergeExplorerClasses(
              iconButtonClass,
              "lxe:ml-auto lxe:size-7 lxe:@[720px]/explorer:hidden",
            )}
            aria-label="ナビゲーションを閉じる"
            onClick={closeNavigation}
          >
            <X size={16} />
          </button>
        </div>
        <nav
          className="lxe:min-h-0 lxe:flex-1 lxe:overflow-y-auto lxe:py-2 lxe:[scrollbar-width:thin]"
          aria-label="ファイルの場所"
        >
          <ul className="lxe:space-y-0.5 lxe:px-2 lxe:pb-3">
            {[
              { id: "root", label: rootLabel, Icon: Files, visible: true },
              {
                id: RECENT,
                label: "最近更新した項目",
                Icon: Clock3,
                visible: features.recent,
              },
              {
                id: FAVORITES,
                label: "お気に入り",
                Icon: Star,
                visible: features.favorites,
              },
            ]
              .filter((item) => item.visible)
              .map(({ id, label, Icon }) => (
                <li key={String(id)}>
                  <button
                    type="button"
                    className={`lxe:flex lxe:h-8 lxe:w-full lxe:items-center lxe:gap-3 lxe:rounded lxe:px-3 lxe:text-left lxe:text-[13px] lxe:outline-offset-[-2px] lxe:hover:bg-[var(--explorer-hover)] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)] ${location === id ? "lxe:bg-[var(--explorer-selection)]" : ""} ${id === "root" && dragOver === "root" ? "lxe:outline-1 lxe:-outline-offset-1 lxe:outline-[var(--explorer-accent)]" : ""}`}
                    aria-current={location === id ? "page" : undefined}
                    onClick={() => goTo(id)}
                    onDragOver={
                      id === "root"
                        ? (event) => allowDrop(event, "root")
                        : undefined
                    }
                    onDragLeave={
                      id === "root" ? () => setDragOver(null) : undefined
                    }
                    onDrop={
                      id === "root"
                        ? (event) => void drop(event, "root")
                        : undefined
                    }
                  >
                    <Icon
                      size={17}
                      className={`lxe:shrink-0 ${id === FAVORITES ? "lxe:text-[var(--explorer-folder)]" : "lxe:text-[var(--explorer-accent)]"}`}
                    />
                    <span className="lxe:truncate">{label}</span>
                  </button>
                </li>
              ))}
          </ul>
          <div className="lxe:flex lxe:items-center lxe:justify-between lxe:border-t lxe:border-[var(--explorer-border)] lxe:px-4 lxe:py-1.5 lxe:text-xs lxe:text-[var(--explorer-muted)]">
            <span>フォルダ</span>
          </div>
          <ul className="lxe:pb-4" aria-label="フォルダ一覧">
            <li>
              <div
                className={`lxe:flex lxe:h-8 lxe:min-w-0 lxe:items-center lxe:gap-0.5 lxe:pr-2 lxe:hover:bg-[var(--explorer-hover)] ${location === "root" ? "lxe:bg-[var(--explorer-selection)]" : ""} ${dragOver === "root" ? "lxe:bg-[var(--explorer-selection)] lxe:outline-1 lxe:-outline-offset-1 lxe:outline-[var(--explorer-accent)]" : ""}`}
                style={{ paddingLeft: 10 }}
                onDragOver={(event) => allowDrop(event, "root")}
                onDragLeave={() => setDragOver(null)}
                onDrop={(event) => void drop(event, "root")}
              >
                <button
                  type="button"
                  aria-label={`${rootLabel}（ルート）を${rootOpen ? "折りたたむ" : "展開"}`}
                  aria-expanded={rootHasChildren ? rootOpen : undefined}
                  tabIndex={rootHasChildren ? 0 : -1}
                  className={mergeExplorerClasses(
                    iconButtonClass,
                    "lxe:h-7 lxe:w-5 lxe:text-[var(--explorer-muted)]",
                    !rootHasChildren && "lxe:invisible",
                  )}
                  onClick={() =>
                    setExpanded((old) => rootOpen ? old.filter((id) => id !== "root") : [...old, "root"])
                  }
                >
                  <ChevronRight size={13} className={rootOpen ? "lxe:rotate-90" : ""} />
                </button>
                <button
                  type="button"
                  aria-label={`${rootLabel}（ルート）`}
                  title="/"
                  aria-current={location === "root" ? "page" : undefined}
                  className="lxe:flex lxe:h-full lxe:min-w-0 lxe:flex-1 lxe:items-center lxe:gap-2 lxe:rounded-sm lxe:text-left lxe:text-[13px] lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]"
                  onClick={() => goTo("root")}
                >
                  <HardDrive size={16} className="lxe:shrink-0 lxe:text-[var(--explorer-muted)]" />
                  <span className="lxe:truncate">{rootLabel}</span>
                </button>
              </div>
              {rootOpen && rootHasChildren && <ul>{tree("root")}</ul>}
            </li>
          </ul>
        </nav>
        <footer className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-2 lxe:border-t lxe:border-[var(--explorer-border)] lxe:px-4 lxe:py-3 lxe:text-xs lxe:text-[var(--explorer-muted)]">
          <HardDrive size={15} className="lxe:shrink-0" />
          <span>
            {fileCount} ファイル · {formatSize(totalSize)}
          </span>
        </footer>
      </aside>
      <ExplorerSidebarResizer
        resize={sidebarResize}
        controlsId={`${instanceId}-navigation`}
      />
    </>
  );
});
