"use client";

import { memo, useCallback, useEffect, useMemo, useState, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "radix-ui";
import { mergeExplorerRootClasses } from "./ui/explorer-classnames";
import { Check, CircleAlert, Info, X } from "lucide-react";
import { ExplorerProvider } from "./state/explorer-context";
import { MediaCacheContext } from "./state/media-context";
import { ExplorerThemeContext, explorerThemeStyle, useExplorerColorScheme } from "./ui/explorer-theme";
import { useExplorerViewController } from "./state/use-explorer-controller";
import { useExplorerWorkspace, type ExplorerWorkspace } from "./state/use-explorer-workspace";
import { ExplorerDomContext } from "./ui/explorer-dom-context";
import { ExplorerSidebar } from "./ui/explorer-sidebar";
import { ExplorerHeader } from "./ui/explorer-header";
import { ExplorerStatusBar } from "./ui/explorer-status-bar";
import { ExplorerFileList } from "./ui/explorer-file-list";
import { ExplorerDialogs } from "./ui/explorer-dialogs";
import { iconButtonClass } from "./ui/explorer-controls";
import type { ExplorerProps } from "./props";

export type { ExplorerProps } from "./props";
export type { ExplorerEntry, ExplorerSavePayload } from "./model/draft";

export default function Explorer(props: ExplorerProps) {
  const workspace = useExplorerWorkspace(props);
  const ownerDocument = typeof document === "undefined" ? null : document;
  return <ExplorerWorkspaceView props={props} workspace={workspace} ownerDocument={ownerDocument} />;
}

/** Render an existing workspace without tying its lifetime to its display window. */
export function ExplorerWorkspaceView({ props, workspace, ownerDocument, mainWindowTitle = false }: {
  props: ExplorerProps;
  workspace: ExplorerWorkspace;
  ownerDocument: Document | null;
  mainWindowTitle?: boolean;
}) {
  return <MediaCacheContext.Provider value={workspace.mediaCache}>
    <ExplorerPane props={props} workspace={workspace} windowId="main" ownerDocument={ownerDocument} updateWindowTitle={mainWindowTitle} />
    {workspace.windows.map(view => createPortal(
      <ExplorerPane props={props} workspace={workspace} windowId={view.id} ownerDocument={view.container.ownerDocument} />,
      view.container, view.id,
    ))}
  </MediaCacheContext.Provider>;
}

const ExplorerPane = memo(function ExplorerPane({ props, workspace, windowId, ownerDocument, updateWindowTitle = false }: {
  props: ExplorerProps;
  workspace: ExplorerWorkspace;
  windowId: string;
  ownerDocument: Document | null;
  updateWindowTitle?: boolean;
}) {
  const controller = useExplorerViewController(props, workspace, windowId, ownerDocument);
  const [dialogContainer, setDialogContainer] = useState<HTMLDivElement | null>(null);
  const environment = useMemo(() => ({ document: ownerDocument, portalContainer: ownerDocument?.body,
    dialogContainer: dialogContainer ?? undefined }), [ownerDocument, dialogContainer]);
  useEffect(() => {
    // Update the owned browser document, not a React data object.
    // eslint-disable-next-line react-hooks/immutability
    if ((windowId !== "main" || updateWindowTitle) && ownerDocument) ownerDocument.title = `${controller.title} — エクスプローラー`;
  }, [controller.title, windowId, ownerDocument, updateWindowTitle]);
  const {
    workspaceRef,
    instanceId,
    fileInput,
    folderInput,
    acceptChosenFiles,
    notification,
    setNotification,
    features,
    uiOptions,
  } = controller;
  const attachWorkspace = useCallback((element: HTMLDivElement | null) => {
    workspaceRef.current = element;
    setDialogContainer(element);
  }, [workspaceRef]);
  const colorScheme = useExplorerColorScheme(props.colorMode, props.theme, ownerDocument);
  const themeStyle = useMemo(() => ({
    ...explorerThemeStyle(props.theme, colorScheme),
    ...Object.fromEntries(
      Object.entries(props.style ?? {}).filter(([key]) =>
        key.startsWith("--explorer-"),
      ),
    ),
  }), [props.theme, props.style, colorScheme]);
  useEffect(() => {
    if ((!updateWindowTitle && windowId === "main") || !ownerDocument) return;
    // Only Explorer-owned windows receive document colors. The embedded host
    // keeps full ownership of its page background and native control scheme.
    const bodyStyle = ownerDocument.body.style;
    const declarations = [
      ...Object.entries(themeStyle).filter(([key]) => key.startsWith("--explorer-")),
      ["font-family", themeStyle.fontFamily ?? ""],
      ["color-scheme", themeStyle.colorScheme ?? ""],
      ["background-color", "var(--explorer-background)"],
      ["color", "var(--explorer-foreground)"],
    ];
    const previous = declarations.map(([key]) => [
      key, bodyStyle.getPropertyValue(key), bodyStyle.getPropertyPriority(key),
    ]);
    declarations.forEach(([key, value]) => bodyStyle.setProperty(key, String(value)));
    // Restore only owned properties so an open dialog keeps its scroll lock.
    return () => previous.forEach(([key, value, priority]) => {
      if (value) bodyStyle.setProperty(key, value, priority);
      else bodyStyle.removeProperty(key);
    });
  }, [ownerDocument, updateWindowTitle, windowId, themeStyle]);
  const NoticeIcon =
    notification?.kind === "error"
      ? CircleAlert
      : notification?.kind === "success"
        ? Check
        : Info;

  return (
    <ExplorerDomContext.Provider value={environment}>
      <ExplorerThemeContext.Provider value={themeStyle}>
        <ExplorerProvider value={controller}>
          <Tooltip.Provider delayDuration={450}>
            <div
              ref={attachWorkspace}
              data-explorer-root={instanceId}
              data-likex-explorer=""
              role="region"
              aria-label={props["aria-label"] ?? "エクスプローラー"}
              tabIndex={-1}
              onDragEnd={controller.endDrag}
              onDragOver={(event) => {
                if (
                  event.dataTransfer.types.some((type) =>
                    ["Files", "application/x-explorer"].includes(type),
                  )
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "none";
                }
              }}
              onDrop={(event) => {
                if (
                  event.dataTransfer.types.some((type) =>
                    ["Files", "application/x-explorer"].includes(type),
                  )
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  controller.endDrag();
                }
              }}
              style={{ ...themeStyle, ...props.style }}
              className={mergeExplorerRootClasses(
                "lxe:@container/explorer lxe:relative lxe:isolate lxe:flex lxe:h-full lxe:min-h-0 lxe:min-w-0 lxe:flex-1 lxe:flex-col lxe:overflow-hidden lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:text-sm lxe:leading-normal lxe:text-[var(--explorer-foreground)] lxe:outline-none",
                props.className,
              )}
            >
              <ExplorerHeader title={props.title} />
              <div
                id={`${instanceId}-panel`}
                role={features.tabs ? "tabpanel" : undefined}
                aria-labelledby={
                  features.tabs
                    ? `${instanceId}-tab-${controller.activeTabId}`
                    : undefined
                }
                className="lxe:relative lxe:flex lxe:min-h-0 lxe:min-w-0 lxe:flex-1"
              >
                {uiOptions.sidebar && <ExplorerSidebar />}
                <div className="lxe:flex lxe:min-h-0 lxe:min-w-0 lxe:flex-1 lxe:flex-col">
                  <ExplorerFileList />
                  <ExplorerStatusBar />
                </div>
              </div>
              {features.uploadFiles && (
                <input
                  type="file"
                  multiple
                  ref={fileInput}
                  hidden
                  aria-label="追加するファイル"
                  accept={workspace.draft.uploadAccept}
                  onChange={(event) => {
                    if (event.target.files)
                      acceptChosenFiles(Array.from(event.target.files));
                    event.target.value = "";
                  }}
                />
              )}
              {features.uploadFolders && (
                <input
                  type="file"
                  multiple
                  ref={folderInput}
                  hidden
                  aria-label="追加するフォルダ"
                  {...({
                    webkitdirectory: "",
                  } as InputHTMLAttributes<HTMLInputElement>)}
                  onChange={(event) => {
                    if (event.target.files)
                      acceptChosenFiles(Array.from(event.target.files), "folder");
                    event.target.value = "";
                  }}
                />
              )}
              <div
                className="lxe:pointer-events-none lxe:absolute lxe:right-3 lxe:bottom-12 lxe:z-30 lxe:max-w-[calc(100%-1.5rem)]"
                aria-live="polite"
                aria-atomic="true"
              >
                {notification && (
                  <div className="lxe:pointer-events-auto lxe:flex lxe:w-80 lxe:max-w-full lxe:items-start lxe:gap-2 lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:p-3 lxe:shadow-lg">
                    <NoticeIcon
                      size={18}
                      className={`lxe:mt-0.5 lxe:shrink-0 ${notification.kind === "error" ? "lxe:text-[var(--explorer-danger)]" : "lxe:text-[var(--explorer-accent)]"}`}
                    />
                    <div className="lxe:min-w-0 lxe:flex-1 lxe:text-sm lxe:wrap-anywhere">
                      <p>{notification.message}</p>
                      {notification.description && (
                        <p className="lxe:mt-1 lxe:max-h-[min(16rem,40dvh)] lxe:overflow-y-auto lxe:text-xs lxe:whitespace-pre-line lxe:text-[var(--explorer-muted)]">
                          {notification.description}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label="通知を閉じる"
                      onClick={() => setNotification(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
              <ExplorerDialogs />
            </div>
          </Tooltip.Provider>
        </ExplorerProvider>
      </ExplorerThemeContext.Provider>
    </ExplorerDomContext.Provider>
  );
});
