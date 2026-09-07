"use client";

import { createContext, useContext } from "react";

export type ExplorerDomContextValue = {
  document: Document | null;
  portalContainer?: HTMLElement;
  /** Dialogs are positioned within this Explorer, while menus may escape it. */
  dialogContainer?: HTMLElement;
};

export const ExplorerDomContext = createContext<ExplorerDomContextValue | null>(null);

/** Each Explorer pane owns its DOM environment, including its overlay portals. */
export function useExplorerDom(): ExplorerDomContextValue {
  const environment = useContext(ExplorerDomContext);
  return environment ?? {
    document: typeof document === "undefined" ? null : document,
  };
}
