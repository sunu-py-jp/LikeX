"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ExternalSearchController } from "../state/use-external-search";

export function ExternalSearchPanel<T>({ search, visible, focus, location, onClose, onLocalSearch }: {
  search: ExternalSearchController<T>; visible: boolean; focus: number; location(target: T): string;
  onClose(): void; onLocalSearch(): void;
}) {
  const [limit, setLimit] = useState(200);
  const shown = Math.max(limit, Math.ceil((search.index + 1) / 200) * 200);
  const keyboardFocus = useRef(false), requestedFocus = useRef(false), scrolledId = useRef<string | null>(null);
  const id = useId(), active = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestedFocus.current = visible;
    if (!visible) return;
    (active.current ?? list.current)?.focus({ preventScroll: true });
    if (active.current) requestedFocus.current = false;
  }, [visible, focus]);
  useEffect(() => {
    if (!visible) return;
    if (scrolledId.current !== search.activeId) { active.current?.scrollIntoView?.({ block: "nearest" }); scrolledId.current = search.activeId; }
    if (keyboardFocus.current || requestedFocus.current) { keyboardFocus.current = false; active.current?.focus({ preventScroll: true }); if (active.current) requestedFocus.current = false; }
  }, [visible, search.activeId]);
  return <aside data-slide-view-only="" className="lxp-search-panel" aria-labelledby={`${id}-heading`} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="lxp-search-heading"><h2 id={`${id}-heading`}>{search.title}</h2><button type="button" aria-label="検索を閉じる" onClick={onClose}><X size={17} /></button></div>
    <div className="lxp-search-controls">
      <button type="button" className="lxp-search-mode" onClick={onLocalSearch}>文書内を検索</button>
      <div className="lxp-search-navigation"><span role="status" aria-live="polite">{Math.max(0, search.index + 1)} / {search.results.length} 件</span>
        <button type="button" aria-label="前の検索結果" disabled={!search.ready || !search.results.length} onClick={() => search.navigate(-1)}><ChevronUp size={17} /></button>
        <button type="button" aria-label="次の検索結果" disabled={!search.ready || !search.results.length} onClick={() => search.navigate(1)}><ChevronDown size={17} /></button>
      </div>
      <button type="button" className="lxp-search-mode" disabled={!search.ready || search.index < 0} onClick={() => { if (search.activeId) search.activate(search.activeId); }}>選択した結果に戻る</button>
      {search.error && <p className="lxp-search-error" role="alert">{search.error}</p>}
      {!search.results.length && <p className="lxp-search-empty">検索結果はありません。</p>}
    </div>
    <div ref={list} className="lxp-search-results lxp-external-search-results" aria-label="外部検索結果" tabIndex={0} onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || !search.ready) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); keyboardFocus.current = true; search.navigate(event.key === "ArrowDown" ? 1 : -1); }
    }}>
      {search.results.slice(0, shown).map(result => {
        const issue = search.resultError(result);
        return <button type="button" key={result.id} data-external-result-id={result.id} className="lxp-search-result" ref={result.id === search.activeId ? active : undefined}
          aria-current={result.id === search.activeId ? "true" : undefined} disabled={!search.ready || !!issue}
          title={issue ?? undefined} onClick={() => search.activate(result.id)}>
          <span className="lxp-search-location">{result.locationLabel ?? (issue || !search.ready ? "参照先を表示できません" : location(result.target))}</span>
          {result.title && <strong>{result.title}</strong>}
          {result.snippet && <span className="lxp-search-snippet">{result.snippet}</span>}
          {issue && <span className="lxp-search-error">{issue}</span>}
        </button>;
      })}
      {shown < search.results.length && <button type="button" className="lxp-search-mode" onClick={() => setLimit(shown + 200)}>さらに表示（残り {search.results.length - shown} 件）</button>}
    </div>
  </aside>;
}
