"use client";

import { memo } from "react";
import { Grid2X2, List } from "lucide-react";
import { mergeExplorerClasses } from "./explorer-classnames";
import { useExplorerFields } from "../state/explorer-context";
import { formatSize } from "../model/entries";
import { iconButtonClass, viewModes } from "./explorer-controls";

export const ExplorerStatusBar = memo(function ExplorerStatusBar() {
  const {
    visible,
    selected,
    selectedEntries,
    saveError,
    refreshError,
    view,
    changeView,
    allowedViewModes,
    selectionOptions,
    readOnly,
    editMode,
    saving,
    refreshing,
  } = useExplorerFields("visible", "selected", "selectedEntries", "saveError", "refreshError", "view", "changeView", "allowedViewModes", "selectionOptions", "readOnly", "editMode", "saving", "refreshing");
  return (
    <footer
      className="lxe:flex lxe:min-h-8 lxe:shrink-0 lxe:flex-wrap lxe:items-center lxe:gap-x-3 lxe:gap-y-1 lxe:border-t lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)] lxe:px-3 lxe:py-0.5 lxe:text-xs lxe:text-[var(--explorer-muted)]"
      aria-live="polite"
    >
      <span className="lxe:whitespace-nowrap">{visible.length} 個の項目</span>
      {readOnly && <span className="lxe:whitespace-nowrap">読み取り専用</span>}
      {selectionOptions.mode !== "none" && selected.length > 0 && (
        <>
          <span
            aria-hidden="true"
            className="lxe:h-3 lxe:w-px lxe:bg-[var(--explorer-border)]"
          />
          <span className="lxe:whitespace-nowrap">
            {selected.length} 個の項目を選択
          </span>
          <span className="lxe:hidden lxe:@[600px]/explorer:inline">
            {formatSize(
              selectedEntries.reduce((total, entry) => total + entry.size, 0),
            )}
          </span>
        </>
      )}
      {editMode === "requesting" ? (
        <span>編集の許可を確認しています…</span>
      ) : saving ? (
        <span>保存しています…</span>
      ) : refreshing ? (
        <span>再読み込みしています…</span>
      ) : null}
      {allowedViewModes.length > 1 && (
        <div className="lxe:ml-auto lxe:flex lxe:items-center lxe:gap-2">
          <span className="lxe:hidden lxe:@[850px]/explorer:inline">
            {viewModes.find((mode) => mode.id === view)?.label}
          </span>
          {(allowedViewModes.includes("details") ||
            allowedViewModes.includes("large")) && (
            <div
              className="lxe:flex lxe:items-center"
              role="group"
              aria-label="表示方法"
            >
              {allowedViewModes.includes("details") && (
                <button
                  type="button"
                  className={mergeExplorerClasses(
                    iconButtonClass,
                    "lxe:h-6 lxe:w-8 lxe:rounded-none",
                    view === "details" &&
                      "lxe:bg-[var(--explorer-selection)] lxe:text-[var(--explorer-accent)]",
                  )}
                  aria-label="詳細表示"
                  aria-pressed={view === "details"}
                  onClick={() => changeView("details")}
                >
                  <List size={16} />
                </button>
              )}
              {allowedViewModes.includes("large") && (
                <button
                  type="button"
                  className={mergeExplorerClasses(
                    iconButtonClass,
                    "lxe:h-6 lxe:w-8 lxe:rounded-none",
                    view === "large" &&
                      "lxe:bg-[var(--explorer-selection)] lxe:text-[var(--explorer-accent)]",
                  )}
                  aria-label="大アイコン表示"
                  aria-pressed={view === "large"}
                  onClick={() => changeView("large")}
                >
                  <Grid2X2 size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {(refreshError || saveError) && (
        <span
          className="lxe:basis-full lxe:pb-1 lxe:leading-relaxed lxe:break-words lxe:text-[var(--explorer-danger)]"
          role="alert"
        >
          {refreshError || saveError}
        </span>
      )}
    </footer>
  );
});
