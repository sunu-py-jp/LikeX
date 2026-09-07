"use client";

/* Local object URLs are owned by the browser, not a server image optimizer. */
/* eslint-disable @next/next/no-img-element */

import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Folder } from "lucide-react";
import { mergeExplorerClasses } from "./explorer-classnames";
import type { ExplorerEntry as Entry } from "../model/draft";
import type { ExplorerFileReader } from "../model/file-content";
import { entryExtension } from "../model/entries";
import { fileIconStyle, type FileIconStyle } from "../model/file-icon-style";
import { describeEntry } from "../model/item-info";
import { useOptionalExplorerSelector } from "../state/explorer-context";
import { useMediaCache, useMediaRevision } from "../state/media-context";
import { useMediaVisible } from "../state/use-media-visible";
import type { ExplorerIconContext } from "../props";
import { useExplorerTheme } from "./explorer-theme";

type IconOptions = {
  location?: ExplorerIconContext["location"];
  selected?: boolean;
  expanded?: boolean;
};

type FileIconProps = IconOptions & {
  entry: Entry;
  large?: boolean;
  className?: string;
  defaultIcon?: ReactNode;
};

function useIconEntry(entry: Entry): Entry {
  // The fallback is public React data too. Its props must not expose the draft,
  // and keeping this copy stable avoids rereading thumbnails on parent renders.
  return useMemo(
    () => ({ ...entry, source: entry.source ? { ...entry.source } : null }),
    [entry],
  );
}

function DocumentFileIcon({ appearance }: { appearance: FileIconStyle }) {
  return (
    <svg viewBox="0 0 40 48" fill="none" aria-hidden="true" focusable="false"
      data-explorer-file-extension={appearance.label || undefined}>
      <path d="M9 2.5H25L34 11.5V42A3 3 0 0 1 31 45H9A3 3 0 0 1 6 42V5.5A3 3 0 0 1 9 2.5Z"
        fill={appearance.paper} stroke={appearance.ink} strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M25 2.5V9.5A2 2 0 0 0 27 11.5H34Z"
        fill={appearance.ink} stroke={appearance.ink} strokeWidth={1.3} strokeLinejoin="round" />
      {appearance.label && <text x={20} y={29} fill={appearance.ink}
        fontFamily="Arial, sans-serif" fontWeight={500}
        fontSize={appearance.label.length > 4 ? 8 : 9.5} textAnchor="middle"
        letterSpacing={0}>{appearance.label}</text>}
    </svg>
  );
}

function DefaultFileIcon({
  entry,
  large = false,
  className,
  defaultIcon,
}: FileIconProps) {
  const theme = useExplorerTheme();
  const folder = entry.kind === "folder";
  const appearance = fileIconStyle(entryExtension(entry), theme.colorScheme === "dark" ? "dark" : "light");
  return (
    <span
      aria-hidden="true"
      data-explorer-default-icon
      className={mergeExplorerClasses(
        "lxe:pointer-events-none lxe:inline-flex lxe:shrink-0 lxe:items-center lxe:justify-center lxe:[&_svg]:size-full",
        large ? "lxe:size-20" : "lxe:h-[23px] lxe:w-5",
        folder
          ? "lxe:text-[var(--explorer-folder)] lxe:[&_svg]:fill-[var(--explorer-folder)]"
          : undefined,
        className,
      )}
      style={folder ? undefined : { color: appearance.ink }}
    >
      {defaultIcon ?? (folder ? <Folder strokeWidth={1} />
        : <DocumentFileIcon appearance={appearance} />)}
    </span>
  );
}

function useIconOverride(
  entry: Entry,
  defaultIcon: ReactElement,
  { location = "list", selected, expanded }: IconOptions,
) {
  const context = useOptionalExplorerSelector(context => context?.renderIcon ? {
    entries: context.entries,
    renderIcon: context.renderIcon,
    view: context.view,
    selected: selected ?? (context.selectedSet?.has(entry.id) ?? context.selected.includes(entry.id)),
    expanded: expanded ?? (entry.kind === "folder" && context.expanded.includes(entry.id)),
  } : null);
  return context?.renderIcon?.({
    entry: describeEntry(context.entries, entry),
    location,
    view: context.view,
    selected: context.selected,
    expanded: context.expanded,
    defaultIcon,
  });
}

function CustomIcon({
  children,
  large = false,
  className,
}: {
  children: ReactNode;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={mergeExplorerClasses(
        "lxe:pointer-events-none lxe:inline-flex lxe:shrink-0 lxe:items-center lxe:justify-center lxe:[&>*]:h-full lxe:[&>*]:max-h-full lxe:[&>*]:w-full lxe:[&>*]:max-w-full lxe:[&_svg]:max-h-full lxe:[&_svg]:max-w-full lxe:[&_img]:max-h-full lxe:[&_img]:max-w-full lxe:[&_img]:object-contain lxe:[&_[data-explorer-default-icon]]:size-full",
        large ? "lxe:size-20" : "lxe:h-[23px] lxe:w-5",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const FileIcon = memo(function FileIcon({
  entry,
  large = false,
  className,
  defaultIcon,
  ...options
}: FileIconProps) {
  const iconEntry = useIconEntry(entry);
  const fallback = (
    <DefaultFileIcon
      entry={iconEntry}
      large={large}
      className={className}
      defaultIcon={defaultIcon}
    />
  );
  const custom = useIconOverride(entry, fallback, options);
  return custom == null || custom === fallback ? (
    fallback
  ) : (
    <CustomIcon large={large} className={className}>
      {custom}
    </CustomIcon>
  );
});

type FileThumbnailProps = IconOptions & {
  entry: Entry;
  readFile?: ExplorerFileReader;
  className?: string;
};

function DefaultFileThumbnail({
  entry,
  readFile,
  className,
}: FileThumbnailProps) {
  const cache = useMediaCache();
  const { ref, visible } = useMediaVisible();
  const sourceId = entry.source?.kind === "existing" ? entry.source.id : null;
  const revision = useMediaRevision(cache, sourceId !== null && visible);
  const file = entry.source?.kind === "local" ? entry.source.file : null;
  const source = useMemo<Entry["source"]>(() => file ? { kind: "local", file } :
    sourceId !== null ? { kind: "existing", id: sourceId } : null, [sourceId, file]);
  const reader = file ? undefined : readFile;
  const [thumbnail, setThumbnail] = useState<{
    source: Entry["source"];
    reader?: ExplorerFileReader;
    revision: number;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!source || !visible) return;
    let active = true;
    const lease = cache.acquire(source, reader);
    void lease.promise
      .then(() => {
        if (!active) return;
        setThumbnail({ source, reader, revision, url: lease.objectUrl() });
      })
      .catch(() => {
        // Keep the file icon when the host cannot provide content.
        lease.release();
      });
    return () => {
      active = false;
      lease.release();
    };
  }, [cache, source, reader, revision, visible]);

  return <span ref={ref} className={mergeExplorerClasses("lxe:pointer-events-none lxe:inline-flex lxe:size-20 lxe:shrink-0 lxe:items-center lxe:justify-center", className)}>
    {visible && thumbnail?.source === source && thumbnail.reader === reader && thumbnail.revision === revision && cache.hasObjectUrl(thumbnail.url) ? (
    <img
      aria-hidden="true"
      data-explorer-default-icon
      src={thumbnail.url}
      alt=""
      loading="lazy"
      className="lxe:pointer-events-none lxe:size-full lxe:object-contain"
    />
  ) : (
    <DefaultFileIcon entry={entry} large className="lxe:size-full" />
  )}</span>;
}

export const FileThumbnail = memo(function FileThumbnail({
  entry,
  readFile,
  className,
  ...options
}: FileThumbnailProps) {
  const iconEntry = useIconEntry(entry);
  // Reading content belongs to the fallback component. A custom icon that does
  // not include defaultIcon never mounts it or allocates a thumbnail URL.
  const fallback = (
    <DefaultFileThumbnail
      entry={iconEntry}
      readFile={readFile}
      className={className}
    />
  );
  const custom = useIconOverride(entry, fallback, options);
  return custom == null || custom === fallback ? (
    fallback
  ) : (
    <CustomIcon large className={className}>
      {custom}
    </CustomIcon>
  );
});
