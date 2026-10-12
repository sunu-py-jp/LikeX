import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createSearchPanelState, getInitialSearchMode, isSearchPanelQuery, normalizeExternalSearchResults, notifyHost } from "../core";
import type { SpreadsheetProps } from "../props";
import type { SpreadsheetSelectionApi } from "../api/selection";
import type { SpreadsheetWorkbook } from "../model/types";
import { resolveExternalSearchTarget } from "./external-search-target";

/** Search belongs to the view, independent of the ribbon and the editing session. */
export function useSpreadsheetSearchPanel(props: SpreadsheetProps, features: { search: boolean; replace: boolean }, readOnly: boolean,
  navigation: { getWorkbook: () => SpreadsheetWorkbook; getReplacementRevision: () => number; selectionApi: SpreadsheetSelectionApi }) {
  type State = { mode: "find" | "replace" | "external" | null; source: "find" | "external"; query: string; focus: number;
    externalResultId: string | null; externalError: string | null };
  const [request, setRequest] = useState<State>(() => {
    const initial = createSearchPanelState(props), source = getInitialSearchMode(props) === "external" ? "external" : "find";
    return { mode: initial.open && features.search ? source : null, source, query: initial.query, focus: initial.focus,
      externalResultId: null, externalError: null };
  });
  const results = useMemo(() => normalizeExternalSearchResults(props.externalSearch?.results), [props.externalSearch?.results]);
  const initialized = useRef(false);
  const sourceBinding = useRef<{ results: NonNullable<SpreadsheetProps["externalSearch"]>["results"] | undefined; revision: number } | null>(null);
  const latest = useRef({ features, readOnly, navigation, externalSearch: props.externalSearch, results, mounted: true });
  useLayoutEffect(() => {
    latest.current = { features, readOnly, navigation, externalSearch: props.externalSearch, results, mounted: true };
    if (!sourceBinding.current || sourceBinding.current.results !== props.externalSearch?.results)
      sourceBinding.current = { results: props.externalSearch?.results, revision: navigation.getReplacementRevision() };
    return () => { latest.current.mounted = false; };
  });
  const enabled = request.mode === "replace" ? features.replace && !readOnly : features.search && (request.mode !== "external" || !!props.externalSearch);
  if (request.mode && !enabled) setRequest({ ...request, mode: null });
  function chooseExternalSearchResult(resultId: string): boolean {
    const current = latest.current;
    if (!current.mounted || !current.features.search || !current.externalSearch) return false;
    if (sourceBinding.current?.revision !== current.navigation.getReplacementRevision()) {
      setRequest(previous => ({ ...previous, externalError: "ブックが切り替わりました。現在のブックに対応する検索結果を取得してください。" }));
      return false;
    }
    initialized.current = true;
    const result = current.results.find(item => item.id === resultId);
    if (!result) {
      setRequest(previous => ({ ...previous, externalError: "この検索結果は現在の一覧にありません。" }));
      return false;
    }
    const target = resolveExternalSearchTarget(current.navigation.getWorkbook(), result.target);
    if (!target) {
      setRequest(previous => ({ ...previous, externalResultId: result.id, externalError: "対象のシートまたはセル範囲が見つかりません。" }));
      return false;
    }
    if (!current.navigation.selectionApi.selectRange(target.sheetId, target.range, { reveal: true })) {
      setRequest(previous => ({ ...previous, externalResultId: result.id, externalError: "現在は移動できません。セルの入力状態やシートの操作設定を確認してください。" }));
      return false;
    }
    setRequest(previous => ({ ...previous, externalResultId: result.id, externalError: null }));
    notifyHost(current.externalSearch.onResultSelect, result);
    return true;
  }
  useLayoutEffect(() => {
    if (request.mode !== "external" || !enabled || initialized.current || !results.length) return;
    const initial = props.externalSearch?.initialResultId;
    const result = initial === undefined ? results[0] : results.find(item => item.id === initial);
    if (result) chooseExternalSearchResult(result.id);
  });
  function openSearch(query?: string): boolean {
    if (!latest.current.mounted || !latest.current.features.search || query !== undefined && !isSearchPanelQuery(query)) return false;
    const hasExternal = !!latest.current.externalSearch;
    setRequest(previous => {
      const source = query !== undefined || !hasExternal ? "find" : previous.source;
      return { ...previous, mode: source, source, query: query ?? previous.query, focus: previous.focus + 1 };
    });
    return true;
  }
  function openLocalSearch(): boolean {
    if (!latest.current.mounted || !latest.current.features.search) return false;
    // The local input can retain longer queries than the common public injection API accepts.
    setRequest(previous => ({ ...previous, mode: "find", source: "find", focus: previous.focus + 1 }));
    return true;
  }
  function openExternalSearch(resultId?: string): boolean {
    const current = latest.current;
    if (!current.mounted || !current.features.search || !current.externalSearch ||
      resultId !== undefined && (typeof resultId !== "string" || !current.results.some(result => result.id === resultId))) return false;
    setRequest(previous => ({ ...previous, mode: "external", source: "external", focus: previous.focus + 1 }));
    return resultId === undefined || chooseExternalSearchResult(resultId);
  }
  function openReplace(): boolean {
    if (!latest.current.mounted || !latest.current.features.replace || latest.current.readOnly) return false;
    setRequest(previous => ({ ...previous, mode: "replace", source: "find", focus: previous.focus + 1 }));
    return true;
  }
  function closeSearch() {
    if (latest.current.mounted) setRequest(previous => ({ ...previous, mode: null }));
  }
  function setSearchPanelQuery(query: string) {
    if (latest.current.mounted) setRequest(previous => previous.query === query ? previous : { ...previous, query });
  }
  return { searchPanel: { ...request, mode: enabled ? request.mode : null }, externalSearch: props.externalSearch, externalSearchResults: results,
    chooseExternalSearchResult, openSearch, openLocalSearch, openExternalSearch, openReplace, closeSearch, setSearchPanelQuery };
}
