"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeExternalSearchResults, notifyHost, type ExternalSearchOptions, type ExternalSearchResult } from "../core";

type Configuration<T> = {
  options?: ExternalSearchOptions<T>;
  source: unknown;
  enabled: boolean;
  visible: boolean;
  ready: boolean;
  navigationEnabled?: boolean;
  validate(target: T): string | null;
  navigate(target: T): boolean;
};
/** External results navigate existing data; their text is never executed as a local query. */
export function useExternalSearch<T>(config: Configuration<T>) {
  const results = useMemo(() => normalizeExternalSearchResults(config.options?.results), [config.options?.results]);
  const [binding, setBinding] = useState({ source: config.source, results: config.options?.results });
  if (binding.results !== config.options?.results) setBinding({ source: config.source, results: config.options?.results });
  const validSource = binding.source === config.source;
  const [activeId, setActiveId] = useState<string | null>(null), [error, setError] = useState("");
  const [request, setRequest] = useState<{ id: string; version: number; source: unknown } | null>(null);
  const current = useRef({ ...config, results, validSource, active: false });
  const initial = useRef<{ source: unknown; done: boolean }>({ source: config.source, done: false });
  useLayoutEffect(() => { current.current = { ...config, results, validSource, active: true }; });
  useLayoutEffect(() => () => { current.current.active = false; }, []);
  const activate = useCallback((id: string): boolean => {
    const value = current.current;
    if (!value.active || !value.enabled || !value.validSource || !value.ready || value.navigationEnabled === false || !value.visible) return false;
    const result = value.results.find(item => item.id === id);
    if (!result) { setError("この検索結果は現在の一覧にありません。"); return false; }
    const issue = value.validate(result.target);
    if (issue) { setError(issue); return false; }
    if (!value.navigate(result.target)) return false;
    initial.current = { source: value.source, done: true };
    setActiveId(id); setError("");
    notifyHost(value.options?.onResultSelect, result);
    return true;
  }, []);
  const open = useCallback((id?: string): boolean => {
    const value = current.current;
    if (!value.active || !value.enabled || !value.options || !value.validSource || id !== undefined &&
      (typeof id !== "string" || !value.results.some(result => result.id === id))) return false;
    if (id !== undefined) {
      const result = value.results.find(result => result.id === id)!;
      if (value.ready && value.validate(result.target)) return false;
      setRequest(previous => ({ id, version: (previous?.version ?? 0) + 1, source: value.source }));
    }
    return true;
  }, []);
  const handledRequest = useRef<typeof request>(null);
  useEffect(() => {
    if (initial.current.source !== config.source) initial.current = { source: config.source, done: false };
    if (!config.visible || !config.enabled || !config.ready || config.navigationEnabled === false || !validSource || !config.options) return;
    if (request && request.source === config.source && handledRequest.current !== request) {
      handledRequest.current = request; initial.current.done = true; activate(request.id); return;
    }
    if (initial.current.done || !results.length) return;
    const initialId = config.options.initialResultId ?? results[0].id;
    // A ranked result list may arrive in batches. Never replace an explicit
    // preferred result with an earlier batch or consume its pending intent.
    if (!results.some(result => result.id === initialId)) return;
    initial.current.done = true;
    activate(initialId);
  }, [config.source, config.visible, config.enabled, config.ready, config.navigationEnabled, config.options, results, validSource, request, activate]);
  const active = results.find(result => result.id === activeId), index = active ? results.indexOf(active) : -1;
  return {
    results, activeId, index, activate, open, available: !!config.options, validSource,
    title: typeof config.options?.title === "string" ? config.options.title : "外部検索結果",
    error: validSource ? error : "表示中の資料に対応する検索結果を指定してください。",
    ready: config.ready && validSource && config.enabled && config.navigationEnabled !== false,
    navigate: (direction: -1 | 1) => {
      if (!results.length) return;
      const next = index < 0 ? direction > 0 ? 0 : results.length - 1 : (index + direction + results.length) % results.length;
      activate(results[next].id);
    },
    resultError: (result: ExternalSearchResult<T>) => validSource && config.ready ? config.validate(result.target) : null,
  };
}
export type ExternalSearchController<T> = ReturnType<typeof useExternalSearch<T>>;
