"use client";

import { memo } from "react";
import { Check, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import type { ExplorerSearchRenderContext } from "../props";
import { isComposingKeyEvent, shortcutAriaKeys } from "../model/keyboard";
import { useExplorerFields } from "../state/explorer-context";
import { DropdownMenu } from "./explorer-overlays";
import { useExplorerDom } from "./explorer-dom-context";
import { useExplorerTheme } from "./explorer-theme";
import { mergeExplorerClasses } from "./explorer-classnames";
import { iconButtonClass, menuContentClass, menuItemClass } from "./explorer-controls";

/** Search logic stays in the controller; hosts can compose or replace these controls. */
export const ExplorerSearch = memo(function ExplorerSearch() {
  const { query, searchText, searchTrigger, searchPending, searchError, searchConditions, searchParams,
    setSearchConditions, setQuery, submitSearch, clearSearch, setSearchComposing, searchInput, instanceId, renderSearch } = useExplorerFields(
    "query", "searchText", "searchTrigger", "searchPending", "searchError", "searchConditions", "searchParams",
    "setSearchConditions", "setQuery", "submitSearch", "clearSearch", "setSearchComposing", "searchInput", "instanceId", "renderSearch");
  const { portalContainer } = useExplorerDom(), theme = useExplorerTheme();
  const inputProps: ExplorerSearchRenderContext["inputProps"] = {
    maxLength: searchConditions.useRegex ? 4096 : 100_000,
    ref: searchInput, role: "searchbox", value: searchText,
    onChange: event => setQuery(event.target.value),
    onCompositionStart: () => setSearchComposing(true),
    onCompositionEnd: event => { setSearchComposing(false); setQuery(event.currentTarget.value); },
    onKeyDown: event => {
      if (event.defaultPrevented || isComposingKeyEvent(event)) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); submitSearch(); }
    },
    placeholder: searchTrigger === "submit" ? "検索語を入力して Enter" : "ファイルを検索",
    "aria-label": "ファイルを検索", "aria-describedby": `${instanceId}-search-hint`, "aria-keyshortcuts": shortcutAriaKeys("search"),
    "aria-invalid": !!searchError,
    className: "lxe:h-full lxe:w-full lxe:min-w-0 lxe:border-0 lxe:bg-transparent lxe:text-[13px] lxe:text-[var(--explorer-foreground)] lxe:outline-none lxe:placeholder:text-[var(--explorer-muted)]",
  };
  const defaultInput = <div className="lxe:flex lxe:h-8 lxe:min-w-0 lxe:flex-1 lxe:items-center lxe:gap-2 lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-2.5 lxe:focus-within:border-[var(--explorer-accent)]">
    <input {...inputProps} />
    {(searchText || query) && <button type="button" className={mergeExplorerClasses(iconButtonClass, "lxe:size-6")} aria-label="検索をクリア" onClick={clearSearch}><X size={16} aria-hidden="true" /></button>}
    {searchPending && <span role="status" aria-label="検索中" className="lxe:inline-flex lxe:shrink-0 lxe:text-[var(--explorer-muted)]"><Loader2 size={16} aria-hidden="true" className="lxe:animate-spin lxe:motion-reduce:animate-none" /></span>}
    {searchTrigger === "submit" ? <button type="button" className={mergeExplorerClasses(iconButtonClass, "lxe:size-6")} aria-label="検索を実行" onClick={submitSearch}><Search size={16} aria-hidden="true" /></button> : !searchPending && !searchText && !query ? <Search size={16} aria-hidden="true" className="lxe:shrink-0 lxe:text-[var(--explorer-muted)]" /> : null}
  </div>;
  const activeConditions = Object.values(searchConditions).some(Boolean);
  const defaultOptions = <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" aria-label="検索オプション" title="検索オプション" className={mergeExplorerClasses(iconButtonClass, activeConditions ? "lxe:text-[var(--explorer-accent)] lxe:bg-[var(--explorer-selection)]" : "")}><SlidersHorizontal size={16} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal container={portalContainer}><DropdownMenu.Content data-explorer-portal={instanceId} style={theme} sideOffset={5} align="end" className={menuContentClass} aria-label="検索条件">
      {([ ["matchCase", "大文字と小文字を区別"], ["wholeName", "ファイル名全体に一致"], ["useRegex", "正規表現を使用（RE2）"] ] as const).map(([key, label]) => <DropdownMenu.CheckboxItem key={key} checked={searchConditions[key]} onCheckedChange={checked => setSearchConditions({ [key]: checked === true })} onSelect={event => event.preventDefault()} className={mergeExplorerClasses(menuItemClass, "lxe:relative lxe:pl-8")}>
        <DropdownMenu.ItemIndicator className="lxe:absolute lxe:left-2 lxe:inline-flex"><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator>{label}
      </DropdownMenu.CheckboxItem>)}
      <p className="lxe:max-w-64 lxe:px-3 lxe:py-2 lxe:text-xs lxe:text-[var(--explorer-muted)]">正規表現はRE2形式です。先読み・後読み・後方参照は使えません。</p>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
  const context: ExplorerSearchRenderContext = { query: searchText, setQuery, conditions: searchConditions, setConditions: setSearchConditions,
    params: searchParams, trigger: searchTrigger, searching: searchPending, error: searchError,
    submit: submitSearch, clear: clearSearch, inputProps, defaultInput, defaultOptions };
  const custom = renderSearch?.(context);
  return <div role="search" aria-label="ファイル検索" className="lxe:flex lxe:min-w-0 lxe:basis-full lxe:flex-wrap lxe:items-center lxe:gap-1 lxe:@[1000px]/explorer:basis-72">
    {custom ?? <>{defaultInput}{defaultOptions}</>}
    <span id={`${instanceId}-search-hint`} className="lxe:sr-only">{searchTrigger === "submit" ? "Enter キーまたは検索ボタンで検索します" : "入力すると検索します"}</span>
  </div>;
});
