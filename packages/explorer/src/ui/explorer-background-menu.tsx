"use client";

import { useState, type ReactElement } from "react";
import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";
import { useExplorerFields } from "../state/explorer-context";
import { ContextMenu } from "./explorer-overlays";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "./explorer-controls";
import { ExplorerCustomMenuItems } from "./explorer-custom-menu-items";
import type { ExplorerCustomMenu } from "../state/use-explorer-context-menu";
import { useMenuActionHandoff } from "./use-menu-action-handoff";

/** Add to the displayed folder, only from the list's empty space. */
export function ExplorerBackgroundMenu({ children }: { children: ReactElement }) {
  const { features, uiOptions, special, query, busy, showModal, chooseFiles, setSelected, instanceId, hasCustomContextMenu, getCustomContextMenu } =
    useExplorerFields("features", "uiOptions", "special", "query", "busy", "showModal", "chooseFiles", "setSelected", "instanceId", "hasCustomContextMenu", "getCustomContextMenu");
  const [customMenu, setCustomMenu] = useState<ExplorerCustomMenu | null>(null);
  const [open, setOpen] = useState(false);
  const actionHandoff = useMenuActionHandoff();
  const theme = useExplorerTheme();
  const { portalContainer } = useExplorerDom();
  const allowBuiltins = !special && !query.trim();
  const hasCreate = allowBuiltins && (features.createFile || features.createFolder);
  const hasUpload = allowBuiltins && (features.uploadFiles || features.uploadFolders);
  if (!uiOptions.contextMenu || (!hasCreate && !hasUpload && !hasCustomContextMenu)) return children;

  return (
    <ContextMenu.Root open={open} onOpenChange={nextOpen => {
      const menu = nextOpen ? getCustomContextMenu() : customMenu;
      if (nextOpen) setCustomMenu(menu);
      const allowed = nextOpen && (hasCreate || hasUpload || !!menu?.items.length);
      actionHandoff.onOpenChange(allowed);
      setOpen(allowed);
    }}>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(event) => {
          // Entry menus and controls keep their own context menus. Prevent only
          // this outer trigger, after the descendant received the event.
          if ((event.target as HTMLElement).closest(
            "[data-explorer-entry],button,input,select,textarea,a,thead,[role='menu'],[data-explorer-rename-editor]",
          )) event.preventDefault();
          else setSelected([]);
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal container={portalContainer}>
        <ContextMenu.Content
          data-explorer-portal={instanceId}
          data-explorer-background-menu
          style={theme}
          className={`${menuContentClass} lxe:min-w-56`}
          collisionPadding={8}
          onCloseAutoFocus={actionHandoff.onCloseAutoFocus}
        >
          {allowBuiltins && features.createFile && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => showModal("createFile")}>
              <FilePlus />新しいファイル
            </ContextMenu.Item>
          )}
          {allowBuiltins && features.createFolder && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => showModal("create")}>
              <FolderPlus />新しいフォルダ
            </ContextMenu.Item>
          )}
          {hasCreate && hasUpload && <ContextMenu.Separator className={menuSeparatorClass} />}
          {allowBuiltins && features.uploadFiles && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => chooseFiles()}>
              <Upload />ファイルをアップロード
            </ContextMenu.Item>
          )}
          {allowBuiltins && features.uploadFolders && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => chooseFiles(true)}>
              <FolderUp />フォルダをアップロード
            </ContextMenu.Item>
          )}
          <ExplorerCustomMenuItems menu={customMenu} separate={hasCreate || hasUpload} defer={actionHandoff.defer} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
