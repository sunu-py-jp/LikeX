"use client";

import { memo, type CSSProperties, type SyntheticEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ExplorerPendingImportEntry } from "../state/import-preview";
import type { ExplorerViewMode } from "../model/config";
import { entryExtension, formatSize } from "../model/entries";
import { DefaultFileIcon } from "./explorer-file-icon";

const stopInteraction = (event: SyntheticEvent) => event.stopPropagation();
const preventInteraction = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};
const pendingEvents = {
  // A preview is not an entry: never let it select files or open a background
  // context menu, and do not pass its temporary ID to host renderers/actions.
  onClick: stopInteraction,
  onDoubleClick: stopInteraction,
  onPointerDown: stopInteraction,
  onContextMenu: preventInteraction,
  onDragStart: preventInteraction,
  draggable: false,
};

function ImportStatus({ className = "", parentPath }: { className?: string; parentPath?: string }) {
  return <span className={`lxe:inline-flex lxe:min-w-0 lxe:max-w-full lxe:items-center lxe:gap-2 lxe:whitespace-nowrap lxe:text-xs lxe:text-[var(--explorer-muted)] ${parentPath ? "" : "lxe:shrink-0"} ${className}`}>
    <span className="lxe:inline-flex lxe:shrink-0 lxe:items-center lxe:gap-1">
      <Loader2 aria-hidden="true" size={12} className="lxe:shrink-0 lxe:animate-spin lxe:motion-reduce:animate-none" />
      取り込み中
    </span>
    {parentPath && <span className="lxe:min-w-0 lxe:truncate" title={parentPath}>{parentPath}</span>}
  </span>;
}

function importParentPath(relativePath: string) {
  return relativePath.slice(0, Math.max(0, relativePath.lastIndexOf("/")));
}

type PreviewProps = {
  preview: ExplorerPendingImportEntry;
  style?: CSSProperties;
  compact: boolean;
};

export const ExplorerPendingImportRow = memo(function ExplorerPendingImportRow({
  preview: { entry, relativePath }, style, compact, rowIndex, showCheckboxes, showActions,
}: PreviewProps & { rowIndex: number; showCheckboxes: boolean; showActions: boolean }) {
  const cellClass = `${compact ? "lxe:h-7" : "lxe:h-9"} lxe:px-3 lxe:text-xs lxe:text-[var(--explorer-muted)]`;
  const parentPath = importParentPath(relativePath);
  return <tr {...pendingEvents} data-explorer-pending-import={entry.id} aria-busy="true"
    aria-rowindex={rowIndex} style={style} className="lxe:select-none lxe:cursor-default">
    {showCheckboxes && <td />}
    <td className={cellClass}>
      <div className="lxe:flex lxe:min-w-0 lxe:items-center lxe:gap-2.5">
        <DefaultFileIcon entry={entry} />
        <span className={`lxe:min-w-0 lxe:truncate lxe:text-sm lxe:text-[var(--explorer-foreground)] ${parentPath ? "lxe:max-w-[70%] lxe:shrink-0" : ""}`} title={relativePath}>{entry.name}</span>
        {parentPath && <span className="lxe:min-w-0 lxe:truncate lxe:text-xs" title={parentPath}>{parentPath}</span>}
      </div>
    </td>
    <td className={cellClass}><ImportStatus /></td>
    <td className={`${cellClass} lxe:truncate`} title={entryExtension(entry)}>{entryExtension(entry)}</td>
    <td className={`${cellClass} lxe:tabular-nums`}>{formatSize(entry.size)}</td>
    {showActions && <td />}
  </tr>;
});

export const ExplorerPendingImportCard = memo(function ExplorerPendingImportCard({
  preview: { entry, relativePath }, style, compact, view, className, visualClassName,
}: PreviewProps & { view: Exclude<ExplorerViewMode, "details">; className: string; visualClassName: string }) {
  const horizontal = view === "small" || view === "list";
  const descriptive = view === "tiles" || view === "content";
  const parentPath = importParentPath(relativePath);
  return <div {...pendingEvents} data-explorer-pending-import={entry.id} aria-busy="true"
    style={style} className={`${className} lxe:select-none`}>
    <div className={`lxe:flex lxe:shrink-0 lxe:items-center lxe:justify-center ${visualClassName}`}>
      <DefaultFileIcon entry={entry} large />
    </div>
    <span title={relativePath}
      className={`lxe:min-w-0 lxe:truncate lxe:text-sm lxe:font-normal ${horizontal ? "lxe:flex-1" : ""} ${descriptive ? "lxe:col-start-2 lxe:row-start-1 lxe:text-left" : horizontal ? "lxe:text-left" : "lxe:w-full lxe:text-center"}`}>
      {entry.name}
    </span>
    <ImportStatus parentPath={descriptive || view === "extra-large" ? parentPath : undefined}
      className={descriptive ? "lxe:col-start-2 lxe:row-start-2" : horizontal ? "" : "lxe:mt-0.5"} />
    {view === "content" && <span className={`lxe:col-start-3 lxe:row-span-2 lxe:row-start-1 lxe:pl-2 lxe:text-xs lxe:tabular-nums lxe:text-[var(--explorer-muted)] ${compact ? "" : "lxe:py-1"}`}>{formatSize(entry.size)}</span>}
  </div>;
});
