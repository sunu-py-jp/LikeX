"use client";

import { createPortal } from "react-dom";
import { ExplorerWorkspaceView } from "./explorer";
import { useExplorerWorkspace } from "./state/use-explorer-workspace";
import { useExplorerPopupWindow } from "./state/use-explorer-popup";
import type { ExplorerPopupProps } from "./props";

/** Keep the draft in the host page while showing its view in a separate window. */
export function ExplorerPopup({ renderTrigger, onOpenChange, windowOptions, ...props }: ExplorerPopupProps) {
  const workspace = useExplorerWorkspace(props);
  const { view, ...controls } = useExplorerPopupWindow(
    windowOptions, onOpenChange, workspace.closeDetachedWindows, props.onEvent, workspace.unsavedChangesGuard,
  );

  return <>
    {renderTrigger(controls)}
    {view && createPortal(
      <ExplorerWorkspaceView props={props} workspace={workspace} ownerDocument={view.document} mainWindowTitle />,
      view.container,
    )}
  </>;
}
