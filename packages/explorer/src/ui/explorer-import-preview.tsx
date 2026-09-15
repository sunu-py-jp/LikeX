"use client";

import { memo, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from "react";
import type { ExplorerPendingImportEntry } from "../state/import-preview";
import type { ExplorerViewMode } from "../model/config";
import { entryExtension, formatSize } from "../model/entries";
import { DefaultFileIcon, ExplorerProcessingIcon } from "./explorer-file-icon";

const stopInteraction = (event: SyntheticEvent) => event.stopPropagation();
const preventInteraction = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

function pendingEvents(preview: ExplorerPendingImportEntry, onOpenFolder: (id: string) => void) {
  const { entry } = preview;
  const folder = entry.kind === "folder";
  return {
    // Temporary folders allow navigation, but are never public action targets.
    onClick: stopInteraction,
    onDoubleClick: (event: SyntheticEvent) => {
      event.stopPropagation();
      if (folder) onOpenFolder(entry.id);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      event.stopPropagation();
      if (folder && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onOpenFolder(entry.id);
      }
    },
    onPointerDown: stopInteraction,
    onContextMenu: preventInteraction,
    onDragStart: preventInteraction,
    onDragOver: preventInteraction,
    onDrop: preventInteraction,
    draggable: false,
    tabIndex: folder ? 0 : undefined,
  };
}

type PreviewProps = {
  preview: ExplorerPendingImportEntry;
  style?: CSSProperties;
  compact: boolean;
  onOpenFolder: (id: string) => void;
};

export const ExplorerPendingImportRow = memo(function ExplorerPendingImportRow({
  preview, style, compact, rowIndex, showCheckboxes, showActions, onOpenFolder,
}: PreviewProps & { rowIndex: number; showCheckboxes: boolean; showActions: boolean }) {
  const { entry, relativePath } = preview;
  const cellClass = `${compact ? "lxe:h-7" : "lxe:h-9"} lxe:px-3 lxe:text-xs lxe:text-[var(--explorer-muted)]`;
  return <tr {...pendingEvents(preview, onOpenFolder)} data-explorer-pending-import={entry.id} aria-busy="true"
    aria-rowindex={rowIndex} style={style} className="lxe:select-none lxe:cursor-default lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]">
    {showCheckboxes && <td />}
    <td className={cellClass}>
      <div className="lxe:flex lxe:min-w-0 lxe:items-center lxe:gap-2.5">
        <ExplorerProcessingIcon processing><DefaultFileIcon entry={entry} /></ExplorerProcessingIcon>
        <span className="lxe:min-w-0 lxe:truncate lxe:text-sm lxe:text-[var(--explorer-foreground)]" title={relativePath}>{entry.name}</span>
      </div>
    </td>
    <td className={cellClass} />
    <td className={`${cellClass} lxe:truncate`} title={entryExtension(entry)}>{entryExtension(entry)}</td>
    <td className={`${cellClass} lxe:tabular-nums`}>{entry.kind === "file" ? formatSize(entry.size) : ""}</td>
    {showActions && <td />}
  </tr>;
});

export const ExplorerPendingImportCard = memo(function ExplorerPendingImportCard({
  preview, style, compact, view, className, visualClassName, onOpenFolder,
}: PreviewProps & { view: Exclude<ExplorerViewMode, "details">; className: string; visualClassName: string }) {
  const { entry, relativePath } = preview;
  const horizontal = view === "small" || view === "list";
  const descriptive = view === "tiles" || view === "content";
  return <div {...pendingEvents(preview, onOpenFolder)} data-explorer-pending-import={entry.id} aria-busy="true"
    role={entry.kind === "folder" ? "button" : undefined}
    aria-label={entry.kind === "folder" ? entry.name : undefined}
    style={style} className={`${className} lxe:select-none lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]`}>
    <div className={`lxe:flex lxe:shrink-0 lxe:items-center lxe:justify-center ${visualClassName}`}>
      <ExplorerProcessingIcon processing large><DefaultFileIcon entry={entry} large /></ExplorerProcessingIcon>
    </div>
    <span title={relativePath}
      className={`lxe:min-w-0 lxe:text-sm lxe:font-normal ${horizontal ? "lxe:flex-1" : ""} ${descriptive ? `lxe:col-start-2 lxe:row-start-1 lxe:truncate lxe:text-left ${view === "content" ? "lxe:row-span-2" : ""}` : horizontal ? "lxe:truncate lxe:text-left" : "lxe:line-clamp-2 lxe:w-full lxe:text-center lxe:wrap-anywhere"}`}>
      {entry.name}
    </span>
    {descriptive && <span className={`lxe:text-xs lxe:tabular-nums lxe:text-[var(--explorer-muted)] ${view === "content" ? `lxe:col-start-3 lxe:row-span-2 lxe:row-start-1 lxe:pl-2 ${compact ? "" : "lxe:py-1"}` : "lxe:col-start-2 lxe:row-start-2"}`}>{entry.kind === "file" ? formatSize(entry.size) : ""}</span>}
  </div>;
});
