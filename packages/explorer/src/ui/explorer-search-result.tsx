"use client";

import type { CSSProperties, SyntheticEvent } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerSearchHit } from "../model/search";
import type { ExplorerViewMode } from "../model/config";
import { describeEntry } from "../model/item-info";
import type { ExplorerSearchResultRenderer } from "../props";

const interactiveSelector = "button,a,input,select,textarea,[role='button'],[role='link'],[contenteditable='true']";
function stopInteractivePropagation(event: SyntheticEvent<HTMLDivElement>) {
  const target = (event.target as Element).closest?.(interactiveSelector);
  if (target && event.currentTarget.contains(target)) event.stopPropagation();
}

/** This bounded supplementary area leaves row interaction and virtualization intact. */
export function ExplorerSearchResult({ entry, entries, hit, query, view, selected, render, height, style }: {
  entry: ExplorerEntry;
  entries: readonly ExplorerEntry[];
  hit?: ExplorerSearchHit;
  query: string;
  view: ExplorerViewMode;
  selected: boolean;
  render?: ExplorerSearchResultRenderer;
  height: number;
  style?: CSSProperties;
}) {
  if (!hit || !height) return null;
  const defaultContent = <>
    {hit.snippet && <p className="lxe:m-0 lxe:whitespace-pre-wrap lxe:wrap-anywhere">{hit.snippet}</p>}
    {hit.reason && <p className="lxe:m-0 lxe:whitespace-pre-wrap lxe:wrap-anywhere lxe:text-[var(--explorer-muted)]">{hit.reason}</p>}
  </>;
  const custom = render?.({ entry: describeEntry(entries, entry), hit, query, view, selected, defaultContent });
  const content = custom ?? defaultContent;
  const hasContent = custom == null ? !!(hit.snippet || hit.reason) : typeof custom !== "boolean" && custom !== "";
  return <div data-explorer-search-result={entry.id} tabIndex={hasContent ? 0 : undefined}
    aria-label={hasContent ? `${entry.name}の検索結果詳細` : undefined} role={hasContent ? "group" : undefined}
    onClick={stopInteractivePropagation} onPointerDown={stopInteractivePropagation} onDragStart={stopInteractivePropagation}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()}
    className="lxe:min-w-0 lxe:overflow-auto lxe:py-1 lxe:text-left lxe:text-xs lxe:leading-4 lxe:[scrollbar-width:thin] lxe:focus-visible:outline-2 lxe:focus-visible:outline-offset-[-2px] lxe:focus-visible:outline-[var(--explorer-accent)]"
    style={{ ...style, height, boxSizing: "border-box" }}>{content}</div>;
}
