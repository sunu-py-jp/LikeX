"use client";

import type { ReactElement } from "react";
import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";
import { useExplorerFields } from "../state/explorer-context";
import { ContextMenu } from "./explorer-overlays";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "./explorer-controls";

/** Add to the displayed folder, only from the list's empty space. */
export function ExplorerBackgroundMenu({ children }: { children: ReactElement }) {
  const { features, uiOptions, special, query, busy, showModal, chooseFiles, setSelected, instanceId } =
    useExplorerFields("features", "uiOptions", "special", "query", "busy", "showModal", "chooseFiles", "setSelected", "instanceId");
  const theme = useExplorerTheme();
  const { portalContainer } = useExplorerDom();
  const hasCreate = features.createFile || features.createFolder;
  const hasUpload = features.uploadFiles || features.uploadFolders;
  if (!uiOptions.contextMenu || special || query.trim() || (!hasCreate && !hasUpload)) return children;

  return (
    <ContextMenu.Root>
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
        >
          {features.createFile && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => showModal("createFile")}>
              <FilePlus />新しいファイル
            </ContextMenu.Item>
          )}
          {features.createFolder && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => showModal("create")}>
              <FolderPlus />新しいフォルダ
            </ContextMenu.Item>
          )}
          {hasCreate && hasUpload && <ContextMenu.Separator className={menuSeparatorClass} />}
          {features.uploadFiles && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => chooseFiles()}>
              <Upload />ファイルをアップロード
            </ContextMenu.Item>
          )}
          {features.uploadFolders && (
            <ContextMenu.Item className={menuItemClass} disabled={busy} onSelect={() => chooseFiles(true)}>
              <FolderUp />フォルダをアップロード
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
