"use client";

import { shortcutAriaKeys } from "../model/keyboard";

import { memo, type ComponentProps, type ReactNode } from "react";
import { DropdownMenu } from "./explorer-overlays";
import { mergeExplorerClasses } from "./explorer-classnames";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Ellipsis,
  File,
  Folder,
  FolderInput,
  List,
  Loader2,
  Menu,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useExplorerFields } from "../state/explorer-context";
import type { ExplorerProps } from "../props";
import { ExplorerTabs } from "./explorer-tabs";
import { ExplorerAddressBar } from "./explorer-address-bar";
import { useRenameMenuFocus } from "./explorer-entry-name";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import { RECENT } from "../state/view-state";
import {
  buttonClass,
  iconButtonClass,
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
  ExplorerIconButton,
  viewModes,
} from "./explorer-controls";

function MenuContent({
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  const theme = useExplorerTheme();
  const { portalContainer } = useExplorerDom();
  const { instanceId } = useExplorerFields("instanceId");
  return (
    <DropdownMenu.Portal container={portalContainer}>
      <DropdownMenu.Content
        {...props}
        data-explorer-portal={instanceId}
        style={theme}
        sideOffset={5}
        className={menuContentClass}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

function MenuItem({
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item {...props} className={menuItemClass}>
      {children}
    </DropdownMenu.Item>
  );
}

function MenuRadioItem({
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      {...props}
      className={mergeExplorerClasses(menuItemClass, "lxe:relative lxe:pl-8")}
    >
      <DropdownMenu.ItemIndicator className="lxe:absolute lxe:left-2 lxe:inline-flex">
        <Check size={15} />
      </DropdownMenu.ItemIndicator>
      {children}
    </DropdownMenu.RadioItem>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="lxe:mx-1 lxe:h-5 lxe:w-px lxe:shrink-0 lxe:bg-[var(--explorer-border)]"
    />
  );
}

function Command({
  children,
  ...props
}: ComponentProps<"button"> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={mergeExplorerClasses(
        buttonClass,
        "lxe:shrink-0 lxe:border-transparent lxe:bg-transparent lxe:px-2 lxe:font-normal",
      )}
    >
      {children}
    </button>
  );
}

export const ExplorerHeader = memo(function ExplorerHeader({ title }: Pick<ExplorerProps, "title">) {
  const headerTitle = title?.trim();
  const {
    query,
    travel,
    historyIndex,
    history,
    navigate,
    folder,
    location,
    special,
    searchInput,
    setQuery,
    setSelected,
    disabled,
    showModal,
    startRename,
    chooseFiles,
    copyToClipboard,
    selected,
    paste,
    displayedSort,
    setSort,
    view,
    changeView,
    compact,
    changeCompact,
    visible,
    act,
    selectedEntries,
    download,
    externalDownload,
    busy,
    saving,
    refreshing,
    canRefresh,
    refreshEntries,
    dirty,
    saveChanges,
    setDetailId,
    mobileOpen,
    setOpenMobile,
    instanceId,
    features,
    selectionOptions,
    uiOptions,
    allowedViewModes,
    canPaste,
    readOnly,
    canEditFavorites,
    editMode,
    cancelEditPermission,
  } = useExplorerFields("query", "travel", "historyIndex", "history", "navigate", "folder", "location", "special", "searchInput", "setQuery", "setSelected", "disabled", "showModal", "startRename", "chooseFiles", "copyToClipboard", "selected", "paste", "displayedSort", "setSort", "view", "changeView", "compact", "changeCompact", "visible", "act", "selectedEntries", "download", "externalDownload", "busy", "saving", "refreshing", "canRefresh", "refreshEntries", "dirty", "saveChanges", "setDetailId", "mobileOpen", "setOpenMobile", "instanceId", "features", "selectionOptions", "uiOptions", "allowedViewModes", "canPaste", "readOnly", "canEditFavorites", "editMode", "cancelEditPermission");
  const renameMenuFocus = useRenameMenuFocus();

  const hasUpload = features.uploadFiles || features.uploadFolders;
  const hasEdit =
    features.move || features.copy || features.rename || features.delete;
  const hasView = features.sort || allowedViewModes.length > 1;
  const hasSelectionMenu = selectionOptions.mode !== "none";
  const hasOperationMenu =
    hasEdit || canEditFavorites || features.download || features.details;
  const mobileTrigger = uiOptions.sidebar ? (
    <button
      type="button"
      className={mergeExplorerClasses(
        iconButtonClass,
        "lxe:@[720px]/explorer:hidden",
        features.tabs && "lxe:mb-0.5",
      )}
      aria-label="フォルダのナビゲーションを開く"
      aria-expanded={mobileOpen}
      aria-controls={`${instanceId}-navigation`}
      data-explorer-navigation-trigger
      onClick={() => setOpenMobile(!mobileOpen)}
    >
      <Menu size={18} />
    </button>
  ) : null;

  return (
    <div className="lxe:shrink-0 lxe:bg-[var(--explorer-panel)]">
      {features.tabs && (
        <header className="lxe:flex lxe:h-10 lxe:min-w-0 lxe:items-end lxe:gap-2 lxe:border-b lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-hover)] lxe:px-2 lxe:pt-1.5">
          {mobileTrigger}
          <ExplorerTabs />
          {headerTitle && (
            <span title={headerTitle} className="lxe:ml-auto lxe:hidden lxe:max-w-[30%] lxe:shrink-0 lxe:self-center lxe:truncate lxe:pr-2 lxe:text-xs lxe:text-[var(--explorer-muted)] lxe:@[1000px]/explorer:inline">
              {headerTitle}
            </span>
          )}
        </header>
      )}

      <div className="lxe:flex lxe:flex-wrap lxe:items-center lxe:gap-2 lxe:border-b lxe:border-[var(--explorer-border)] lxe:px-2 lxe:py-2 lxe:@[1000px]/explorer:flex-nowrap lxe:@[1000px]/explorer:px-3">
        {!features.tabs && mobileTrigger}
        <div
          className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-0.5"
          aria-label="フォルダの履歴"
        >
          <ExplorerIconButton
            label="戻る"
            shortcut="back"
            onClick={() => travel(-1)}
            disabled={historyIndex === 0}
          >
            <ArrowLeft size={18} />
          </ExplorerIconButton>
          <ExplorerIconButton
            label="進む"
            shortcut="forward"
            onClick={() => travel(1)}
            disabled={historyIndex >= history.length - 1}
          >
            <ArrowRight size={18} />
          </ExplorerIconButton>
          <ExplorerIconButton
            label="上のフォルダ"
            shortcut="up"
            onClick={() => navigate(folder?.parent ?? "root")}
            disabled={location === "root"}
          >
            <ArrowUp size={18} />
          </ExplorerIconButton>
        </div>
        {canRefresh && (
          <ExplorerIconButton label="更新" shortcut="refresh" onClick={() => void refreshEntries()} disabled={busy}>
            <RefreshCw size={18} className={refreshing ? "lxe:animate-spin lxe:motion-reduce:animate-none" : undefined} />
          </ExplorerIconButton>
        )}
        <ExplorerAddressBar />
        {features.search && (
          <div className="lxe:flex lxe:h-8 lxe:min-w-0 lxe:basis-full lxe:items-center lxe:gap-2 lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-2.5 lxe:focus-within:border-[var(--explorer-accent)] lxe:@[1000px]/explorer:basis-60">
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected([]);
              }}
              placeholder="すべてのファイルを検索"
              aria-label="すべてのフォルダからファイル名で検索"
              aria-keyshortcuts={shortcutAriaKeys("search")}
              className="lxe:h-full lxe:w-full lxe:min-w-0 lxe:border-0 lxe:bg-transparent lxe:text-[13px] lxe:text-[var(--explorer-foreground)] lxe:outline-none lxe:placeholder:text-[var(--explorer-muted)]"
            />
            {query ? (
              <button
                type="button"
                className={mergeExplorerClasses(iconButtonClass, "lxe:size-6")}
                aria-label="検索をクリア"
                onClick={() => setQuery("")}
              >
                <X size={16} />
              </button>
            ) : (
              <Search
                size={16}
                className="lxe:shrink-0 lxe:text-[var(--explorer-muted)]"
              />
            )}
          </div>
        )}
      </div>

      <div
        className="lxe:flex lxe:min-w-0 lxe:items-center lxe:justify-end lxe:gap-1 lxe:border-b lxe:border-[var(--explorer-border)] lxe:p-1.5"
        aria-label="ファイル操作"
      >
        {(hasUpload || hasEdit || hasView) && (
          <div className="lxe:flex lxe:min-w-0 lxe:flex-1 lxe:items-center lxe:gap-1 lxe:overflow-x-auto lxe:[scrollbar-width:thin]">
            {(features.uploadFiles || features.uploadFolders) && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Command disabled={disabled || special}>
                    <Upload size={17} />
                    <span>
                      {features.uploadFiles
                        ? "ファイルを追加"
                        : "フォルダを追加"}
                    </span>
                    <ChevronDown size={12} />
                  </Command>
                </DropdownMenu.Trigger>
                <MenuContent align="start">
                  {features.uploadFiles && (
                    <MenuItem onSelect={() => chooseFiles()}>
                      <File size={16} />
                      ファイルを選択
                    </MenuItem>
                  )}
                  {features.uploadFolders && (
                    <MenuItem onSelect={() => chooseFiles(true)}>
                      <Folder size={16} />
                      フォルダを選択
                    </MenuItem>
                  )}
                </MenuContent>
              </DropdownMenu.Root>
            )}
            {hasUpload && hasEdit && <Divider />}
            {features.move && (
              <ExplorerIconButton
                label="切り取り"
                shortcut="cut"
                onClick={() => copyToClipboard("move")}
                disabled={disabled || !selected.length}
              >
                <Scissors size={17} />
              </ExplorerIconButton>
            )}
            {features.copy && (
              <ExplorerIconButton
                label="コピー"
                shortcut="copy"
                onClick={() => copyToClipboard("copy")}
                disabled={disabled || !selected.length}
              >
                <Copy size={17} />
              </ExplorerIconButton>
            )}
            {(features.move || features.copy) && (
              <ExplorerIconButton
                label="貼り付け"
                shortcut="paste"
                onClick={() => void paste()}
                disabled={disabled || special || !canPaste}
              >
                <ClipboardPaste size={17} />
              </ExplorerIconButton>
            )}
            {features.rename && (
              <ExplorerIconButton
                label="名前の変更"
                shortcut="rename"
                onClick={() => startRename()}
                disabled={disabled || selected.length !== 1}
              >
                <Pencil size={17} />
              </ExplorerIconButton>
            )}
            {features.delete && (
              <ExplorerIconButton
                label="削除"
                shortcut="delete"
                onClick={() => showModal("delete")}
                disabled={disabled || !selected.length}
              >
                <Trash2 size={17} />
              </ExplorerIconButton>
            )}
            {(hasUpload || hasEdit) && hasView && <Divider />}
            {features.sort && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Command>
                    <ArrowUpDown size={17} />
                    <span>並べ替え</span>
                    <ChevronDown size={12} />
                  </Command>
                </DropdownMenu.Trigger>
                <MenuContent align="start">
                  <DropdownMenu.RadioGroup
                    value={displayedSort.key}
                    onValueChange={(key) =>
                      setSort((old) => ({
                        ...old,
                        key: key as typeof displayedSort.key,
                      }))
                    }
                  >
                    {[
                      { key: "name", label: "名前" },
                      { key: "updatedAt", label: "更新日時" },
                      { key: "extension", label: "拡張子" },
                      { key: "size", label: "サイズ" },
                    ].map((option) => (
                      <MenuRadioItem
                        key={option.key}
                        value={option.key}
                        disabled={location === RECENT}
                      >
                        {option.label}
                      </MenuRadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator className={menuSeparatorClass} />
                  <DropdownMenu.RadioGroup
                    value={displayedSort.asc ? "asc" : "desc"}
                    onValueChange={(value) =>
                      setSort((old) => ({ ...old, asc: value === "asc" }))
                    }
                  >
                    <MenuRadioItem value="asc" disabled={location === RECENT}>
                      昇順
                    </MenuRadioItem>
                    <MenuRadioItem value="desc" disabled={location === RECENT}>
                      降順
                    </MenuRadioItem>
                  </DropdownMenu.RadioGroup>
                </MenuContent>
              </DropdownMenu.Root>
            )}
            {allowedViewModes.length > 1 && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Command>
                    <List size={17} />
                    <span>表示</span>
                    <ChevronDown size={12} />
                  </Command>
                </DropdownMenu.Trigger>
                <MenuContent align="start">
                  <DropdownMenu.RadioGroup
                    value={view}
                    onValueChange={(value) => {
                      const mode = allowedViewModes.find((id) => id === value);
                      if (mode) changeView(mode);
                    }}
                  >
                    {viewModes
                      .filter((mode) => allowedViewModes.includes(mode.id))
                      .map((mode) => (
                        <MenuRadioItem key={mode.id} value={mode.id}>
                          {mode.label}
                        </MenuRadioItem>
                      ))}
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator className={menuSeparatorClass} />
                  <DropdownMenu.CheckboxItem
                    checked={compact}
                    onCheckedChange={changeCompact}
                    className={mergeExplorerClasses(menuItemClass, "lxe:relative lxe:pl-8")}
                  >
                    <DropdownMenu.ItemIndicator className="lxe:absolute lxe:left-2 lxe:inline-flex">
                      <Check size={15} />
                    </DropdownMenu.ItemIndicator>
                    コンパクトビュー
                  </DropdownMenu.CheckboxItem>
                </MenuContent>
              </DropdownMenu.Root>
            )}
          </div>
        )}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={iconButtonClass}
              aria-label="その他の操作"
            >
              <Ellipsis size={20} />
            </button>
          </DropdownMenu.Trigger>
          <MenuContent
            align="end"
            onCloseAutoFocus={renameMenuFocus.onCloseAutoFocus}
          >
            {selectionOptions.mode === "multiple" && (
              <MenuItem
                onSelect={() => setSelected(visible.map((entry) => entry.id))}
                disabled={!visible.length}
              >
                <CheckCheck size={16} />
                すべて選択
              </MenuItem>
            )}
            {hasSelectionMenu && (
              <MenuItem
                onSelect={() => setSelected([])}
                disabled={!selected.length}
              >
                選択を解除
              </MenuItem>
            )}
            {hasSelectionMenu && hasOperationMenu && (
              <DropdownMenu.Separator className={menuSeparatorClass} />
            )}
            {features.move && (
              <MenuItem
                onSelect={() => copyToClipboard("move")}
                disabled={disabled || !selected.length}
              >
                <Scissors size={16} />
                切り取り
              </MenuItem>
            )}
            {features.copy && (
              <MenuItem
                onSelect={() => copyToClipboard("copy")}
                disabled={disabled || !selected.length}
              >
                <Copy size={16} />
                コピー
              </MenuItem>
            )}
            {(features.move || features.copy) && (
              <MenuItem
                onSelect={() => void paste()}
                disabled={disabled || special || !canPaste}
              >
                <ClipboardPaste size={16} />
                貼り付け
              </MenuItem>
            )}
            {features.rename && (
              <MenuItem
                onSelect={() => renameMenuFocus.startRename()}
                disabled={disabled || selected.length !== 1}
              >
                <Pencil size={16} />
                名前の変更
              </MenuItem>
            )}
            {features.move && (
              <MenuItem
                onSelect={() => showModal("move")}
                disabled={disabled || !selected.length}
              >
                <FolderInput size={16} />
                移動先を選択
              </MenuItem>
            )}
            {features.copy && (
              <MenuItem
                onSelect={() => showModal("copy")}
                disabled={disabled || !selected.length}
              >
                <Copy size={16} />
                コピー先を選択
              </MenuItem>
            )}
            {canEditFavorites && (
              <MenuItem
                onSelect={() => void act("favorite")}
                disabled={disabled || !selected.length}
              >
                <Star size={16} />
                お気に入りを切り替え
              </MenuItem>
            )}
            {features.download && (
              <MenuItem
                onSelect={() =>
                  selectedEntries.forEach((entry) => {
                    void download(entry);
                  })
                }
                disabled={selectedEntries.length !== 1}
              >
                <ArrowDownToLine size={16} />
                {selectedEntries[0]?.kind === "folder" && !externalDownload ? "ZIPでダウンロード" : "ダウンロード"}
              </MenuItem>
            )}
            {features.details && (
              <MenuItem
                onSelect={() => setDetailId(selected[0])}
                disabled={selected.length !== 1}
              >
                <PanelRight size={16} />
                詳細情報
              </MenuItem>
            )}
            {features.delete && (
              <MenuItem
                onSelect={() => showModal("delete")}
                disabled={disabled || !selected.length}
              >
                <Trash2 size={16} className="lxe:text-[var(--explorer-danger)]" />
                <span className="lxe:text-[var(--explorer-danger)]">削除</span>
              </MenuItem>
            )}
            {(hasSelectionMenu || hasOperationMenu) && (
              <DropdownMenu.Separator className={menuSeparatorClass} />
            )}
            <MenuItem onSelect={() => showModal("help")}>
              <CircleHelp size={16} />
              キーボードショートカット
            </MenuItem>
          </MenuContent>
        </DropdownMenu.Root>

        {!readOnly && <div className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-1 lxe:border-l lxe:border-[var(--explorer-border)] lxe:pl-1.5">
          <ExplorerIconButton
            label="変更を破棄"
            onClick={() => showModal("discard")}
            disabled={busy || !dirty}
          >
            <Undo2 size={17} />
          </ExplorerIconButton>
          {editMode === "requesting" ? (
            <button type="button" className={buttonClass} onClick={cancelEditPermission}>
              <Loader2 size={17} className="lxe:animate-spin lxe:motion-reduce:animate-none" />
              許可待ちを取り消す
            </button>
          ) : <button
            type="button"
            className={mergeExplorerClasses(
              buttonClass,
              "lxe:border-[var(--explorer-accent)] lxe:bg-[var(--explorer-accent)] lxe:px-3 lxe:text-[var(--explorer-accent-foreground)] lxe:hover:bg-[var(--explorer-accent)] lxe:enabled:hover:brightness-95",
            )}
            onClick={() => void saveChanges()}
            aria-keyshortcuts={shortcutAriaKeys("save")}
            disabled={busy || (!dirty && editMode !== "edit")}
          >
            {saving ? (
              <Loader2
                size={17}
                className="lxe:animate-spin lxe:motion-reduce:animate-none"
              />
            ) : (
              <Save size={17} />
            )}
            <span>保存</span>
          </button>}
        </div>}
      </div>
    </div>
  );
});
