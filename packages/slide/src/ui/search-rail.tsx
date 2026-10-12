"use client";

import { useId, type ReactNode } from "react";

/** Both panes stay mounted while changing tabs so page and result scroll positions survive. */
export function SearchRail({ open, pageTab, onTab, search, pages }: {
  open: boolean; pageTab: boolean; onTab(pages: boolean): void; search: ReactNode; pages: ReactNode;
}) {
  const id = useId();
  return <div className={`lxp-search-rail${open ? "" : " is-closed"}`}>
    {<div hidden={!open} className="lxp-search-tabs" role="tablist" aria-label="左側の表示">
      <button type="button" id={`${id}-results-tab`} role="tab" aria-selected={!pageTab} aria-controls={`${id}-results`} onClick={() => onTab(false)}>検索結果</button>
      <button type="button" id={`${id}-pages-tab`} role="tab" aria-selected={pageTab} aria-controls={`${id}-pages`} onClick={() => onTab(true)}>全ページ</button>
    </div>}
    <div id={`${id}-results`} className="lxp-search-rail-pane" role="tabpanel" aria-labelledby={`${id}-results-tab`} hidden={!open || pageTab}>{search}</div>
    <div id={`${id}-pages`} className="lxp-search-rail-pane" role="tabpanel" aria-labelledby={`${id}-pages-tab`} hidden={open && !pageTab}>{pages}</div>
  </div>;
}
