"use client";

import { FolderOpen, FolderPlus, Loader2, Search, Upload } from "lucide-react";
import type { ExplorerEmptyStateRenderContext, ExplorerEmptyStateRenderer } from "../props";
import { buttonClass } from "./explorer-controls";

type EmptyStateProps = Omit<ExplorerEmptyStateRenderContext, "defaultContent"> & {
  pending?: "folder" | "search";
  error?: string | null;
  errorKind?: "folder" | "search";
  retry(): void;
  canEditFavorites: boolean;
  render?: ExplorerEmptyStateRenderer;
};

/** Loading and errors always retain the library's status and retry controls. */
export function ExplorerEmptyState({ reason, location, query, disabled, actions = {},
  pending, error, errorKind, retry, canEditFavorites, render }: EmptyStateProps) {
  const title = pending
    ? pending === "folder" ? "フォルダを読み込んでいます…" : "検索しています…"
    : error
      ? errorKind === "search" ? "検索に失敗しました" : "フォルダを読み込めませんでした"
      : reason === "search" ? "一致するファイルがありません"
        : reason === "favorites" ? "お気に入りはまだありません"
          : reason === "recent" ? "最近更新した項目はありません" : "このフォルダは空です";
  const description = pending
    ? pending === "folder" ? "フォルダの内容を取得しています" : "検索結果を取得しています"
    : error || (reason === "search" ? "別の検索条件で検索してください"
      : reason === "favorites" ? canEditFavorites
        ? "項目を選んで、メニューからお気に入りに追加できます" : "登録済みの項目がここに表示されます"
        : null);
  const Icon = pending ? Loader2 : reason === "search" || error ? Search : FolderOpen;
  const add = actions.addFiles ?? actions.addFolders ?? actions.createFolder;
  const defaultContent = <div role={error ? "alert" : pending ? "status" : undefined}
    className="lxe:flex lxe:h-full lxe:min-h-52 lxe:flex-col lxe:items-center lxe:justify-center lxe:gap-3 lxe:p-6 lxe:text-center">
    <Icon aria-hidden="true" strokeWidth={1.25}
      className={`lxe:size-11 lxe:text-[var(--explorer-muted)] ${pending ? "lxe:animate-spin lxe:motion-reduce:animate-none" : ""}`} />
    <h3 className="lxe:mt-1 lxe:text-base lxe:font-normal">{title}</h3>
    {description && <p className="lxe:text-sm lxe:text-[var(--explorer-muted)]">{description}</p>}
    {!pending && error && <button type="button" className={buttonClass} onClick={retry}>再試行</button>}
    {!pending && !error && reason === "folder" && add && <button type="button" className={buttonClass} disabled={disabled} onClick={add}>
      {actions.addFiles || actions.addFolders ? <Upload size={16} /> : <FolderPlus size={16} />}
      {actions.addFiles ? "追加" : actions.addFolders ? "フォルダを追加" : "フォルダを作成"}
    </button>}
  </div>;
  if (pending || error || !render) return defaultContent;
  const custom = render({ reason, location, query, disabled, actions, defaultContent });
  if (custom == null || custom === defaultContent) return defaultContent;
  if (custom === false) return null;
  return <div data-explorer-custom-empty-state className="lxe:h-full lxe:min-h-52"
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()}
    onPaste={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
    {custom}
  </div>;
}
