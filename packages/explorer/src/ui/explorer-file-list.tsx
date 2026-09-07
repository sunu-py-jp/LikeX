"use client";

import {
  Fragment,
  memo,
  useMemo,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  Copy,
  Ellipsis,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Info,
  Loader2,
  Pencil,
  Scissors,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { ContextMenu, DropdownMenu } from "./explorer-overlays";
import { mergeExplorerClasses } from "./explorer-classnames";
import { useExplorer, useExplorerFields } from "../state/explorer-context";
import { useExplorerVirtualList } from "../state/use-explorer-virtual-list";
import { getEntryIndex } from "../model/entry-index";
import { shortcutAriaKeys, shortcutLabel } from "../model/keyboard";
import { FileIcon, FileThumbnail } from "./explorer-file-icon";
import {
  ExplorerEntryName,
  useEntryRenameDelay,
  useRenameMenuFocus,
} from "./explorer-entry-name";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import { ExplorerBackgroundMenu } from "./explorer-background-menu";
import {
  formatSize,
  getEntryPath,
  entryExtension,
  formatEntryDate,
} from "../model/entries";
import type { ExplorerEntry as Entry } from "../model/draft";
import type { ExplorerViewMode } from "../model/config";
import { FAVORITES, RECENT } from "../state/view-state";
import {
  buttonClass,
  iconButtonClass,
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
} from "./explorer-controls";

const checkboxClass =
  "lxe:size-3.5 lxe:shrink-0 lxe:cursor-pointer lxe:rounded-sm lxe:accent-[var(--explorer-accent)] lxe:focus-visible:outline-2 lxe:focus-visible:outline-offset-2 lxe:focus-visible:outline-[var(--explorer-accent)]";
const headerCellClass =
  "lxe:h-8 lxe:border-b lxe:border-[var(--explorer-border)] lxe:px-3 lxe:text-left lxe:text-xs lxe:font-normal lxe:text-[var(--explorer-muted)] lxe:[&+th]:border-l";

type Features = ReturnType<typeof useExplorer>["features"];

function hasEntryMenu(entry: Entry, features: Features, canEditFavorites: boolean) {
  return (
    entry.kind === "folder" ||
    features.preview ||
    features.details ||
    features.copy ||
    features.move ||
    features.rename ||
    canEditFavorites ||
    features.delete ||
    features.download
  );
}

function EntryMenuItems({
  entry,
  context = false,
  onRename,
}: {
  entry: Entry;
  context?: boolean;
  onRename: (ids: string[]) => void;
}) {
  const {
    selected,
    disabled,
    features,
    openEntry,
    setDetailId,
    copyToClipboard,
    showModal,
    act,
    download,
    externalDownload,
    canEditFavorites,
  } = useExplorerFields("selected", "disabled", "features", "openEntry", "setDetailId", "copyToClipboard", "showModal", "act", "download", "externalDownload", "canEditFavorites");
  const ids = context && selected.includes(entry.id) ? selected : [entry.id];
  const Item = context ? ContextMenu.Item : DropdownMenu.Item;
  const Separator = context ? ContextMenu.Separator : DropdownMenu.Separator;
  const shortcutClass = "lxe:ml-auto lxe:pl-5 lxe:text-xs lxe:text-[var(--explorer-muted)]";
  const groups = [
    [
      (entry.kind === "folder" || features.preview) && (
        <Item
          key="open"
          aria-keyshortcuts={shortcutAriaKeys("open")}
          className={menuItemClass}
          onSelect={() => openEntry(entry)}
        >
          <FolderOpen />
          開く{context && <span className={shortcutClass}>{shortcutLabel("open")}</span>}
        </Item>
      ),
      features.details && (
        <Item
          key="details"
          className={menuItemClass}
          onSelect={() => setDetailId(entry.id)}
        >
          <Info />
          詳細を表示
        </Item>
      ),
    ],
    [
      features.copy && (
        <Item
          key="copy"
          aria-keyshortcuts={shortcutAriaKeys("copy")}
          className={menuItemClass}
          disabled={disabled}
          onSelect={() => copyToClipboard("copy", ids)}
        >
          <Copy />
          コピー{context && <span className={shortcutClass}>{shortcutLabel("copy")}</span>}
        </Item>
      ),
      features.move && (
        <Item
          key="cut"
          aria-keyshortcuts={shortcutAriaKeys("cut")}
          className={menuItemClass}
          disabled={disabled}
          onSelect={() => copyToClipboard("move", ids)}
        >
          <Scissors />
          切り取り{context && <span className={shortcutClass}>{shortcutLabel("cut")}</span>}
        </Item>
      ),
      features.move && (
        <Item
          key="move"
          className={menuItemClass}
          disabled={disabled}
          onSelect={() => showModal("move", ids)}
        >
          <FolderInput />
          移動先を選択
        </Item>
      ),
      features.copy && (
        <Item
          key="copy-to"
          className={menuItemClass}
          disabled={disabled}
          onSelect={() => showModal("copy", ids)}
        >
          <Copy />
          コピー先を選択
        </Item>
      ),
      features.rename && (
        <Item
          key="rename"
          aria-keyshortcuts={shortcutAriaKeys("rename")}
          className={menuItemClass}
          disabled={disabled || ids.length !== 1}
          onSelect={() => onRename([entry.id])}
        >
          <Pencil />
          名前を変更{context && <span className={shortcutClass}>{shortcutLabel("rename")}</span>}
        </Item>
      ),
      canEditFavorites && (
        <Item
          key="favorite"
          className={menuItemClass}
          disabled={disabled}
          onSelect={() =>
            act(
              "favorite",
              [entry.id],
              {},
              entry.favorite
                ? "お気に入りから外しました"
                : "お気に入りに追加しました",
            )
          }
        >
          <Star />
          {entry.favorite ? "お気に入りから外す" : "お気に入りに追加"}
        </Item>
      ),
      features.download && (
        <Item
          key="download"
          className={menuItemClass}
          onSelect={() => download(entry)}
        >
          <ArrowDownToLine />
          {entry.kind === "folder" && !externalDownload ? "ZIPでダウンロード" : "ダウンロード"}
        </Item>
      ),
    ],
    [
      features.delete && (
        <Item
          key="delete"
          aria-keyshortcuts={shortcutAriaKeys("delete")}
          className={`${menuItemClass} lxe:text-[var(--explorer-danger)]`}
          disabled={disabled}
          onSelect={() => showModal("delete", ids)}
        >
          <Trash2 />
          削除{context && <span className={shortcutClass}>{shortcutLabel("delete")}</span>}
        </Item>
      ),
    ],
  ]
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length);
  return groups.map((items, index) => (
    <Fragment key={index}>
      {index > 0 && <Separator className={menuSeparatorClass} />}
      {items}
    </Fragment>
  ));
}

function EntryContext({
  entry,
  children,
  onOpenChange,
}: {
  entry: Entry;
  children: ReactElement;
  onOpenChange?: (open: boolean) => void;
}) {
  const theme = useExplorerTheme();
  const { portalContainer } = useExplorerDom();
  const renameMenuFocus = useRenameMenuFocus();
  const { instanceId, features, uiOptions, canEditFavorites } = useExplorerFields("instanceId", "features", "uiOptions", "canEditFavorites");
  if (!uiOptions.contextMenu || !hasEntryMenu(entry, features, canEditFavorites)) return children;
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal container={portalContainer}>
        <ContextMenu.Content
          data-explorer-portal={instanceId}
          style={theme}
          className={`${menuContentClass} lxe:min-w-60`}
          collisionPadding={8}
          onCloseAutoFocus={renameMenuFocus.onCloseAutoFocus}
        >
          <EntryMenuItems
            entry={entry}
            context
            onRename={renameMenuFocus.startRename}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function RowActions({ entry, onOpenChange }: { entry: Entry; onOpenChange?: (open: boolean) => void }) {
  const theme = useExplorerTheme();
  const { portalContainer } = useExplorerDom();
  const renameMenuFocus = useRenameMenuFocus();
  const { instanceId, disabled, act, features, uiOptions, canEditFavorites } = useExplorerFields("instanceId", "disabled", "act", "features", "uiOptions", "canEditFavorites");
  const showMenu = uiOptions.rowActions && hasEntryMenu(entry, features, canEditFavorites);
  if (!canEditFavorites && !showMenu) return null;
  return (
    <div className="lxe:flex lxe:items-center lxe:justify-end lxe:gap-0.5">
      {canEditFavorites && (
        <button
          type="button"
          aria-label={
            entry.favorite ? "お気に入りから外す" : "お気に入りに追加"
          }
          disabled={disabled}
          className={mergeExplorerClasses(
            iconButtonClass,
            "lxe:size-7",
            entry.favorite
              ? "lxe:text-[var(--explorer-folder)] lxe:[&_svg]:fill-[var(--explorer-folder)]"
              : "lxe:text-[var(--explorer-muted)]",
          )}
          onClick={() =>
            act(
              "favorite",
              [entry.id],
              {},
              entry.favorite
                ? "お気に入りから外しました"
                : "お気に入りに追加しました",
            )
          }
        >
          <Star size={15} />
        </button>
      )}
      {showMenu && (
        <DropdownMenu.Root onOpenChange={onOpenChange}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={mergeExplorerClasses(iconButtonClass, "lxe:size-7")}
              aria-label={`${entry.name}の操作`}
            >
              <Ellipsis size={18} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={portalContainer}>
            <DropdownMenu.Content
              data-explorer-portal={instanceId}
              style={theme}
              className={`${menuContentClass} lxe:min-w-52`}
              align="end"
              sideOffset={4}
              collisionPadding={8}
              onCloseAutoFocus={renameMenuFocus.onCloseAutoFocus}
            >
              <EntryMenuItems
                entry={entry}
                onRename={renameMenuFocus.startRename}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function SortHeader({
  label,
  field,
}: {
  label: string;
  field: "name" | "updatedAt" | "extension" | "size";
}) {
  const { location, displayedSort, sortBy, canSort } = useExplorerFields("location", "displayedSort", "sortBy", "canSort");
  if (!canSort) return label;
  return (
    <button
      type="button"
      className="lxe:flex lxe:h-full lxe:w-full lxe:items-center lxe:gap-1.5 lxe:rounded-sm lxe:text-left lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)] lxe:disabled:cursor-default"
      disabled={location === RECENT}
      onClick={() => sortBy(field)}
    >
      {label}
      {displayedSort.key === field && (
        <ArrowDown
          size={13}
          className={displayedSort.asc ? "lxe:rotate-180" : undefined}
        />
      )}
    </button>
  );
}

/** Every class is a literal so Tailwind can discover all eight display modes. */
type GridViewMode = Exclude<ExplorerViewMode, "details">;
const gridClasses: Record<GridViewMode, string> = {
  "extra-large":
    "lxe:grid lxe:grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] lxe:gap-3 lxe:p-2",
  large:
    "lxe:grid lxe:grid-cols-[repeat(auto-fill,minmax(min(100%,145px),1fr))] lxe:gap-2 lxe:p-2",
  medium:
    "lxe:grid lxe:grid-cols-[repeat(auto-fill,minmax(min(100%,105px),1fr))] lxe:gap-1 lxe:p-2",
  small:
    "lxe:grid lxe:grid-cols-[repeat(auto-fill,minmax(min(100%,215px),1fr))] lxe:gap-x-3 lxe:p-2",
  list: "lxe:flex lxe:h-full lxe:min-h-40 lxe:flex-col lxe:flex-wrap lxe:content-start lxe:gap-x-4 lxe:px-2 lxe:pt-2",
  tiles:
    "lxe:grid lxe:grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] lxe:gap-x-2.5 lxe:gap-y-1 lxe:p-2",
  content: "lxe:flex lxe:flex-col lxe:px-2",
};
const visualClasses: Record<GridViewMode, string> = {
  "extra-large": "lxe:mb-2 lxe:h-40 lxe:w-full lxe:[&>*]:size-36",
  large: "lxe:mb-2 lxe:h-[86px] lxe:w-full lxe:[&>*]:size-20",
  medium: "lxe:mb-1 lxe:h-12 lxe:w-full lxe:[&>*]:size-11",
  small: "lxe:h-[22px] lxe:w-5 lxe:[&>*]:h-[22px] lxe:[&>*]:w-5",
  list: "lxe:h-[22px] lxe:w-5 lxe:[&>*]:h-[22px] lxe:[&>*]:w-5",
  tiles: "lxe:col-start-1 lxe:row-span-2 lxe:row-start-1 lxe:size-14 lxe:[&>*]:size-[52px]",
  content: "lxe:col-start-1 lxe:row-span-2 lxe:row-start-1 lxe:size-14 lxe:[&>*]:size-[52px]",
};

export const ExplorerFileList = memo(function ExplorerFileList() {
  const {
    rootLabel,
    entries,
    visible,
    selectedSet,
    activeTabId,
    focusEntryRef,
    clipboard,
    disabled,
    busy,
    view,
    compact,
    query,
    searchPending,
    searchError,
    retrySearch,
    canSort,
    location,
    special,
    currentParent,
    dragOver,
    externalDrag,
    readFile,
    displayedSort,
    setSelected,
    setDragOver,
    setExternalDrag,
    chooseFiles,
    allowDrop,
    drop,
    rowKey,
    startDrag,
    selectEntry,
    openEntry,
    toggleSelect,
    entryId,
    act,
    features,
    selectionOptions,
    uiOptions,
    canDrag,
    showModal,
    renamingEntryId,
    previewTrigger,
    canEditFavorites,
  } = useExplorerFields("rootLabel", "entries", "visible", "selectedSet", "activeTabId", "focusEntryRef", "clipboard", "disabled", "busy", "view", "compact", "query", "searchPending", "searchError", "retrySearch", "canSort", "location", "special", "currentParent", "dragOver", "externalDrag", "readFile", "displayedSort", "setSelected", "setDragOver", "setExternalDrag", "chooseFiles", "allowDrop", "drop", "rowKey", "startDrag", "selectEntry", "openEntry", "toggleSelect", "entryId", "act", "features", "selectionOptions", "uiOptions", "canDrag", "showModal", "renamingEntryId", "previewTrigger", "canEditFavorites");
  const { scheduleRename, cancelPendingRename } = useEntryRenameDelay();
  const suppressNamePreview = useRef(false);
  const horizontal = view === "small" || view === "list";
  const descriptive = view === "tiles" || view === "content";
  const canSelect = selectionOptions.mode !== "none";
  const showCheckboxes = canSelect && selectionOptions.checkboxes;
  const searching = features.search && Boolean(query);
  const favoritesLocation = features.favorites && location === FAVORITES;
  const recentLocation = features.recent && location === RECENT;
  const showLocation = !recentLocation && (searching || favoritesLocation);
  const showRowMenu = useMemo(() =>
    uiOptions.rowActions &&
    visible.some((entry) => hasEntryMenu(entry, features, canEditFavorites)), [uiOptions.rowActions, visible, features, canEditFavorites]);
  const showActions = canEditFavorites || showRowMenu;
  const columnCount = 4 + Number(showCheckboxes) + Number(showActions);
  const actionWidth = canEditFavorites && showRowMenu ? "lxe:w-[68px]" : "lxe:w-9";
  const showCardControls = showCheckboxes || canEditFavorites;
  const checked = (entry: Entry) => canSelect && selectedSet.has(entry.id);
  const allVisibleSelected = useMemo(() => canSelect && visible.length > 0 && visible.every(entry => selectedSet.has(entry.id)),
    [canSelect, visible, selectedSet]);
  const cutIds = useMemo(() => new Set(clipboard?.action === "move" ? clipboard.ids : []), [clipboard]);
  const entryIndex = useMemo(() => getEntryIndex(entries), [entries]);
  const { enabled: virtualEnabled, scrollRef: scrollContainerRef, items: virtualItems, layout: virtualLayout,
    pin: pinVirtualEntry, contentStyle: virtualContentStyle } = useExplorerVirtualList(visible, view, compact, showLocation, showCardControls,
    JSON.stringify([activeTabId, String(location), query, displayedSort, view]), renamingEntryId, focusEntryRef);
  const acceptsDrop = (event: DragEvent<HTMLElement>) =>
    !busy &&
    (event.dataTransfer.types.includes("Files")
      ? features.uploadFiles
      : canDrag && event.dataTransfer.types.includes("application/x-explorer"));
  const isNamePreviewClick = (entry: Entry, event: MouseEvent<HTMLElement>) =>
    previewTrigger === "click" &&
    features.preview &&
    entry.kind === "file" &&
    (event.target as Element)
      .closest("[data-explorer-entry-name]")
      ?.getAttribute("data-explorer-entry-name") === entry.id;
  const entryEvents = (entry: Entry) => ({
    id: entryId(entry.id),
    "data-explorer-entry": true,
    "data-explorer-entry-id": entry.id,
    tabIndex: 0,
    draggable: canDrag && !disabled && renamingEntryId !== entry.id,
    onPointerDown: () => {
      // Blur may finish a rename before click. That same gesture must not
      // unexpectedly open another file, nor should a drag's trailing click.
      suppressNamePreview.current = Boolean(renamingEntryId);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      cancelPendingRename();
      rowKey(event, entry);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      const previewName = isNamePreviewClick(entry, event);
      if (previewName) cancelPendingRename();
      else scheduleRename(entry, event);
      selectEntry(entry, event);
      if (
        previewName &&
        !busy &&
        !renamingEntryId &&
        !suppressNamePreview.current &&
        !event.defaultPrevented &&
        event.button === 0 &&
        event.detail === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      )
        openEntry(entry);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      cancelPendingRename();
      // The first click on the name already opened this file.
      if (isNamePreviewClick(entry, event)) return;
      if (entry.kind === "folder" || features.preview) openEntry(entry);
    },
    onContextMenu:
      uiOptions.contextMenu && hasEntryMenu(entry, features, canEditFavorites) && canSelect
        ? () => {
            cancelPendingRename();
            if (!checked(entry)) setSelected([entry.id]);
          }
        : undefined,
    onDragStart:
      canDrag && renamingEntryId !== entry.id
        ? (event: DragEvent<HTMLElement>) => {
            cancelPendingRename();
            startDrag(event, entry);
          }
        : undefined,
    onDragOver:
      entry.kind === "folder" && (canDrag || features.uploadFiles)
        ? (event: DragEvent<HTMLElement>) => {
            if (acceptsDrop(event)) allowDrop(event, entry.id);
          }
        : undefined,
    onDrop:
      entry.kind === "folder" && (canDrag || features.uploadFiles)
        ? (event: DragEvent<HTMLElement>) => {
            if (acceptsDrop(event)) drop(event, entry.id);
          }
        : undefined,
  });
  const entryStateClass = (entry: Entry) =>
    [
      "lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]",
      checked(entry)
        ? "lxe:bg-[var(--explorer-selection)]"
        : "lxe:hover:bg-[var(--explorer-hover)]",
      (canDrag || features.uploadFiles) && dragOver === entry.id
        ? "lxe:outline lxe:outline-[var(--explorer-accent)] lxe:bg-[var(--explorer-selection)]"
        : "",
      features.move &&
      clipboard?.action === "move" &&
      cutIds.has(entry.id)
        ? "lxe:opacity-45"
        : "",
    ].join(" ");
  const rowHeightClass = compact ? "lxe:h-7" : "lxe:h-9";
  const cellClass = `${rowHeightClass} lxe:px-3 lxe:text-xs lxe:text-[var(--explorer-muted)]`;

  return (
    <section
      className="lxe:flex lxe:min-h-0 lxe:min-w-0 lxe:flex-1 lxe:flex-col lxe:bg-[var(--explorer-background)]"
      aria-label="ファイル一覧"
      aria-busy={searchPending}
      onFocusCapture={(event) => pinVirtualEntry("focus", (event.target as Element).closest<HTMLElement>("[data-explorer-entry-id]")?.dataset.explorerEntryId ?? null)}
      onBlurCapture={(event) => pinVirtualEntry("focus", (event.relatedTarget as Element | null)?.closest?.<HTMLElement>("[data-explorer-entry-id]")?.dataset.explorerEntryId ?? null)}
      onDragEndCapture={() => pinVirtualEntry("drag", null)}
      onDragStartCapture={(event) => {
        pinVirtualEntry("drag", (event.target as Element).closest<HTMLElement>("[data-explorer-entry-id]")?.dataset.explorerEntryId ?? null);
        cancelPendingRename();
        suppressNamePreview.current = true;
      }}
      onContextMenuCapture={cancelPendingRename}
    >
      <ExplorerBackgroundMenu><div
        ref={scrollContainerRef}
        data-explorer-virtualized={virtualEnabled || undefined}
        className={`lxe:relative lxe:min-h-0 lxe:flex-1 lxe:overflow-auto lxe:px-2 lxe:pb-3 lxe:[scrollbar-width:thin] ${(canDrag || features.uploadFiles) && dragOver === currentParent ? "lxe:ring-2 lxe:ring-[var(--explorer-accent)] lxe:ring-inset" : ""}`}
        onClick={(event) => {
          if (
            !(event.target as HTMLElement).closest(
              "[data-explorer-entry],button,input,select,[role='checkbox']",
            )
          ) {
            setSelected([]);
            // Empty space must also become a paste/keyboard target, including
            // after leaving a search field or opening an empty folder.
            event.currentTarget.closest<HTMLElement>("[data-explorer-root]")?.focus({ preventScroll: true });
          }
        }}
        onDragOver={(event) => {
          if (special || !acceptsDrop(event)) return;
          allowDrop(event, currentParent);
          if (
            features.uploadFiles &&
            event.dataTransfer.types.includes("Files")
          )
            setExternalDrag(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragOver(null);
            setExternalDrag(false);
          }
        }}
        onDrop={(event) => {
          if (!special && acceptsDrop(event)) drop(event, currentParent);
        }}
      >
        {features.uploadFiles && externalDrag && (
          <div className="lxe:pointer-events-none lxe:sticky lxe:top-1/3 lxe:z-20 lxe:mx-auto lxe:-mb-24 lxe:flex lxe:w-[min(390px,90%)] lxe:flex-wrap lxe:items-center lxe:justify-center lxe:gap-2 lxe:rounded-md lxe:border lxe:border-[var(--explorer-accent)] lxe:bg-[var(--explorer-selection)] lxe:p-5 lxe:text-[var(--explorer-foreground)] lxe:shadow-lg">
            <Upload size={24} />
            <strong className="lxe:text-sm lxe:font-medium">
              ここにドロップして追加
            </strong>
            <span className="lxe:w-full lxe:text-center lxe:text-xs">
              保存するまで、この画面で保持します
            </span>
          </div>
        )}
        {searchPending || searchError || !visible.length ? (
          <div role={searchError ? "alert" : searchPending ? "status" : undefined} className="lxe:flex lxe:h-full lxe:min-h-52 lxe:flex-col lxe:items-center lxe:justify-center lxe:gap-3 lxe:p-6 lxe:text-center">
            {searchPending ? (
              <Loader2
                aria-hidden="true"
                className="lxe:size-11 lxe:animate-spin lxe:text-[var(--explorer-muted)] lxe:motion-reduce:animate-none"
                strokeWidth={1.25}
              />
            ) : searching || searchError ? (
              <Search
                aria-hidden="true"
                className="lxe:size-11 lxe:text-[var(--explorer-muted)]"
                strokeWidth={1.25}
              />
            ) : (
              <FolderOpen
                aria-hidden="true"
                className="lxe:size-11 lxe:text-[var(--explorer-muted)]"
                strokeWidth={1.25}
              />
            )}
            <h3 className="lxe:mt-1 lxe:text-base lxe:font-normal">
              {searchPending
                ? "検索しています…"
                : searchError
                  ? "検索に失敗しました"
                  : searching
                    ? "一致するファイルがありません"
                    : favoritesLocation
                      ? "お気に入りはまだありません"
                      : "このフォルダは空です"}
            </h3>
            <p className="lxe:text-sm lxe:text-[var(--explorer-muted)]">
              {searchPending
                ? "検索結果を取得しています"
                : searchError
                  ? searchError
                  : searching
                    ? "別の検索条件で検索してください"
                    : favoritesLocation
                      ? canEditFavorites
                        ? "項目を選んで、メニューからお気に入りに追加できます"
                        : "登録済みの項目がここに表示されます"
                      : features.uploadFiles && features.uploadFolders
                        ? "ファイルやフォルダを追加できます"
                        : features.uploadFiles
                          ? "ファイルを追加できます"
                          : features.uploadFolders
                            ? "フォルダを追加できます"
                            : features.createFolder
                              ? "フォルダを作成できます"
                              : "表示できる項目はありません"}
            </p>
            {!searchPending && searchError && (
              <button type="button" className={buttonClass} onClick={retrySearch}>
                再試行
              </button>
            )}
            {!searchPending &&
              !searchError &&
              !special &&
              !searching &&
              (features.uploadFiles ||
                features.uploadFolders ||
                features.createFolder) && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={disabled}
                  onClick={() =>
                    features.uploadFiles
                      ? chooseFiles()
                      : features.uploadFolders
                        ? chooseFiles(true)
                        : showModal("create")
                  }
                >
                  {features.uploadFiles || features.uploadFolders ? (
                    <Upload size={16} />
                  ) : (
                    <FolderPlus size={16} />
                  )}
                  {features.uploadFiles
                    ? "追加"
                    : features.uploadFolders
                      ? "フォルダを追加"
                      : "フォルダを作成"}
                </button>
              )}
          </div>
        ) : view === "details" ? (
          <table
            aria-rowcount={virtualEnabled ? visible.length + 1 : undefined}
            className="lxe:w-full lxe:table-fixed lxe:border-separate lxe:border-spacing-0 lxe:text-sm"
            style={{
              minWidth:
                538 +
                (showCheckboxes ? 36 : 0) +
                (showActions
                  ? canEditFavorites && showRowMenu
                    ? 68
                    : 36
                  : 0),
            }}
          >
            <thead className="lxe:sticky lxe:top-0 lxe:z-10 lxe:bg-[var(--explorer-background)]">
              <tr>
                {showCheckboxes && (
                  <th className={`${headerCellClass} lxe:w-9 lxe:px-2`}>
                    {selectionOptions.mode === "multiple" ? (
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={allVisibleSelected}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? visible.map((entry) => entry.id)
                              : [],
                          )
                        }
                        aria-label="表示中の項目をすべて選択"
                      />
                    ) : (
                      <span className="lxe:sr-only">選択</span>
                    )}
                  </th>
                )}
                <th
                  className={headerCellClass}
                  aria-sort={
                    !canSort
                      ? undefined
                      : displayedSort.key === "name"
                        ? displayedSort.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                  }
                >
                  <SortHeader field="name" label="名前" />
                </th>
                <th
                  className={`${headerCellClass} lxe:w-32`}
                  aria-sort={
                    !canSort
                      ? undefined
                      : displayedSort.key === "updatedAt"
                        ? displayedSort.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                  }
                >
                  <SortHeader field="updatedAt" label="更新日時" />
                </th>
                <th
                  className={`${headerCellClass} lxe:w-20`}
                  aria-sort={
                    !canSort
                      ? undefined
                      : displayedSort.key === "extension"
                        ? displayedSort.asc ? "ascending" : "descending"
                        : "none"
                  }
                >
                  <SortHeader field="extension" label="拡張子" />
                </th>
                <th
                  className={`${headerCellClass} lxe:w-24`}
                  aria-sort={
                    !canSort
                      ? undefined
                      : displayedSort.key === "size"
                        ? displayedSort.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                  }
                >
                  <SortHeader field="size" label="サイズ" />
                </th>
                {showActions && (
                  <th className={`${headerCellClass} ${actionWidth} lxe:px-1`}>
                    <span className="lxe:sr-only">操作</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {virtualItems.map(({ entry, index }, position) => (
                <Fragment key={entry.id}>
                {virtualEnabled && index > (virtualItems[position - 1]?.index ?? -1) + 1 && (
                  <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: (index - (virtualItems[position - 1]?.index ?? -1) - 1) * virtualLayout.rowHeight, padding: 0, border: 0 }} /></tr>
                )}
                <EntryContext entry={entry} onOpenChange={open => pinVirtualEntry("menu", open ? entry.id : null)}>
                  <tr
                    {...entryEvents(entry)}
                    aria-rowindex={index + 2}
                    style={virtualEnabled ? { height: virtualLayout.rowHeight } : undefined}
                    aria-selected={canSelect ? checked(entry) : undefined}
                    className={`lxe:group lxe:cursor-default ${entryStateClass(entry)}`}
                  >
                    {showCheckboxes && (
                      <td
                        className={`${rowHeightClass} lxe:px-2`}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={checked(entry)}
                          onChange={() => toggleSelect(entry.id)}
                          aria-label={`${entry.name}を選択`}
                        />
                      </td>
                    )}
                    <td className={`${rowHeightClass} lxe:px-3`}>
                      <div className="lxe:flex lxe:min-w-0 lxe:items-center lxe:gap-2.5">
                        <FileIcon entry={entry} />
                        <div className="lxe:flex lxe:min-w-0 lxe:flex-1 lxe:flex-col lxe:py-1">
                          <ExplorerEntryName
                            entry={entry}
                            className="lxe:truncate lxe:text-sm"
                          />
                          {showLocation && (
                            <small className="lxe:truncate lxe:text-xs lxe:text-[var(--explorer-muted)]">
                              {getEntryPath(entries, entry.parent)
                                .map((item) => item.name)
                                .join(" / ") || rootLabel}
                            </small>
                          )}
                        </div>
                        {features.favorites && entry.favorite === 1 && (
                          <Star
                            className="lxe:shrink-0 lxe:fill-[var(--explorer-folder)] lxe:text-[var(--explorer-folder)]"
                            size={13}
                            role="img"
                            aria-label="お気に入り登録済み"
                          />
                        )}
                      </div>
                    </td>
                    <td className={cellClass}>{formatEntryDate(entry.updatedAt)}</td>
                    <td className={`${cellClass} lxe:truncate`} title={entryExtension(entry)}>{entryExtension(entry)}</td>
                    <td className={`${cellClass} lxe:tabular-nums`}>
                      {entry.kind === "folder" ? "" : formatSize(entry.size)}
                    </td>
                    {showActions && (
                      <td
                        className={`${rowHeightClass} lxe:px-1`}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <RowActions entry={entry} onOpenChange={open => pinVirtualEntry("menu", open ? entry.id : null)} />
                      </td>
                    )}
                  </tr>
                </EntryContext>
                </Fragment>
              ))}
              {virtualEnabled && (virtualItems.at(-1)?.index ?? -1) < visible.length - 1 && (
                <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: (visible.length - (virtualItems.at(-1)?.index ?? -1) - 1) * virtualLayout.rowHeight, padding: 0, border: 0 }} /></tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className={`lxe:content-start ${gridClasses[view]}`} style={virtualContentStyle}>
            {virtualItems.map(({ entry, style }) => (
              <EntryContext key={entry.id} entry={entry} onOpenChange={open => pinVirtualEntry("menu", open ? entry.id : null)}>
                <div
                  {...entryEvents(entry)}
                  style={style}
                  role="button"
                  aria-label={entry.name}
                  aria-pressed={canSelect ? checked(entry) : undefined}
                  className={mergeExplorerClasses(
                    `lxe:group lxe:relative lxe:min-w-0 lxe:cursor-default lxe:overflow-hidden lxe:rounded-sm lxe:border lxe:border-transparent ${entryStateClass(entry)} ${horizontal ? `lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-2 lxe:px-1.5 lxe:py-0.5 ${rowHeightClass} ${view === "list" ? "lxe:w-[230px]" : ""}` : descriptive ? `lxe:grid lxe:items-center lxe:gap-x-3 lxe:px-2.5 ${compact ? "lxe:py-1" : "lxe:py-2"} ${view === "content" ? "lxe:min-h-16 lxe:grid-cols-[56px_minmax(100px,1fr)_110px] lxe:grid-rows-2 lxe:rounded-none lxe:border-b-[var(--explorer-border)]" : "lxe:min-h-[72px] lxe:grid-cols-[56px_minmax(0,1fr)] lxe:grid-rows-2"}` : `lxe:flex lxe:flex-col lxe:items-center lxe:px-2 lxe:pb-2 ${showCardControls ? "lxe:pt-4" : "lxe:pt-2"}`}`,
                    renamingEntryId === entry.id && "lxe:z-10 lxe:overflow-visible",
                    horizontal &&
                      renamingEntryId === entry.id &&
                      "lxe:h-auto lxe:min-h-9",
                  )}
                >
                  {!horizontal && !descriptive && showCardControls && (
                    <div
                      className={`lxe:absolute lxe:inset-x-1 lxe:top-1 lxe:z-1 lxe:flex lxe:justify-between ${checked(entry) ? "lxe:opacity-100" : "lxe:opacity-0 lxe:group-hover:opacity-100 lxe:group-focus-within:opacity-100"}`}
                    >
                      {showCheckboxes && (
                        <span
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={checked(entry)}
                            onChange={() => toggleSelect(entry.id)}
                            aria-label={`${entry.name}を選択`}
                          />
                        </span>
                      )}
                      {canEditFavorites && (
                        <button
                          type="button"
                          className={mergeExplorerClasses(
                            iconButtonClass,
                            "lxe:ml-auto lxe:size-5",
                            entry.favorite
                              ? "lxe:text-[var(--explorer-folder)] lxe:[&_svg]:fill-[var(--explorer-folder)]"
                              : "lxe:text-[var(--explorer-muted)]",
                          )}
                          aria-label="お気に入りを切り替え"
                          disabled={disabled}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            act("favorite", [entry.id]);
                          }}
                        >
                          <Star size={15} />
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    className={`lxe:flex lxe:shrink-0 lxe:items-center lxe:justify-center ${visualClasses[view]}`}
                  >
                    {uiOptions.thumbnails &&
                    entry.kind === "file" &&
                    /\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name) ? (
                      <FileThumbnail entry={entry} readFile={readFile} />
                    ) : (
                      <FileIcon entry={entry} large />
                    )}
                  </div>
                  <ExplorerEntryName
                    entry={entry}
                    multiline={
                      view === "medium" ||
                      view === "large" ||
                      view === "extra-large"
                    }
                    className={`lxe:min-w-0 lxe:text-sm lxe:font-normal ${horizontal || descriptive ? "lxe:truncate lxe:text-left" : "lxe:line-clamp-2 lxe:w-full lxe:text-center lxe:wrap-anywhere"} ${descriptive ? `lxe:col-start-2 lxe:row-start-1 ${view === "content" ? "lxe:row-span-2" : ""}` : ""} ${descriptive && features.favorites && !canEditFavorites && entry.favorite ? "lxe:pr-4" : ""}`}
                    editorClassName={
                      descriptive ? `col-start-2 row-start-1 ${view === "content" ? "row-span-2" : ""}` : undefined
                    }
                  />
                  {features.favorites && !canEditFavorites && entry.favorite === 1 && (
                    <Star
                      size={13}
                      role="img"
                      aria-label="お気に入り登録済み"
                      className={mergeExplorerClasses(
                        "lxe:fill-[var(--explorer-folder)] lxe:text-[var(--explorer-folder)]",
                        horizontal ? "lxe:ml-auto lxe:shrink-0" : "lxe:absolute lxe:right-1 lxe:top-1",
                      )}
                    />
                  )}
                  {descriptive && (
                    <p
                      className={`lxe:text-xs lxe:text-[var(--explorer-muted)] ${view === "content" ? "lxe:col-start-3 lxe:row-span-2 lxe:row-start-1 lxe:flex lxe:flex-col-reverse lxe:gap-1.5 lxe:pl-2" : "lxe:col-start-2 lxe:row-start-2"}`}
                    >
                      {entry.kind === "folder"
                        ? `${entryIndex.childrenByParent.get(entry.id)?.length ?? 0} 項目`
                        : formatSize(entry.size)}
                      {view === "content" && (
                        <span>{formatEntryDate(entry.updatedAt)}</span>
                      )}
                    </p>
                  )}
                </div>
              </EntryContext>
            ))}
          </div>
        )}
      </div></ExplorerBackgroundMenu>
    </section>
  );
});
