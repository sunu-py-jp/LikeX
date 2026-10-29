"use client";
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, Regex, WholeWord, X } from "lucide-react";
import type { TextEditorSearchRenderContext } from "../search-types";

/** A nonmodal navigation panel; host-ranked results deliberately have no replace controls. */
export function ExternalSearchPanel({ context }: { context: TextEditorSearchRenderContext }) {
  const input = useRef<HTMLInputElement>(null), panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!context.open) return;
    if (context.mode === "local") input.current?.focus(); else panel.current?.focus();
  }, [context.open, context.mode, context.focusVersion]);
  useEffect(() => {
    const selected = panel.current?.querySelector<HTMLElement>('[aria-current="true"]');
    selected?.scrollIntoView?.({ block: "nearest" });
  }, [context.activeResultId]);
  if (!context.open) return null;
  const active = context.results.findIndex(result => result.id === context.activeResultId);
  return <section ref={panel} className="lxte-result-search" role="dialog" aria-label={context.title} aria-modal={false} tabIndex={-1} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); context.close(); }
    else if (event.key === "Enter" && event.target === input.current) { event.preventDefault(); void (event.shiftKey ? context.previous() : context.next()); }
  }}>
    <div className="lxte-result-search-bar">
      {context.mode === "external" ? <strong>{context.title}</strong> : <div className="lxte-result-search-query"><input ref={input} aria-label="検索する文字列" value={context.query.query} placeholder="検索" maxLength={4096} onChange={event => context.setQuery({ ...context.query, query: event.target.value })} />
        <button type="button" aria-label="大文字と小文字を区別" title="大文字と小文字を区別" aria-pressed={!!context.query.caseSensitive} onClick={() => context.setQuery({ ...context.query, caseSensitive: !context.query.caseSensitive })}><CaseSensitive size={16} /></button>
        <button type="button" aria-label="単語単位" title="単語単位" aria-pressed={!!context.query.wholeWord} onClick={() => context.setQuery({ ...context.query, wholeWord: !context.query.wholeWord })}><WholeWord size={16} /></button>
        <button type="button" aria-label="正規表現" title="正規表現" aria-pressed={!!context.query.regex} onClick={() => context.setQuery({ ...context.query, regex: !context.query.regex })}><Regex size={16} /></button>
      </div>}
      <span className="lxte-result-search-count" aria-live="polite">{context.busy ? "検索中…" : `${active + 1} / ${context.results.length}`}</span>
      <button type="button" aria-label="前の検索結果" title="前の検索結果" disabled={context.busy || !context.results.length} onClick={() => void context.previous()}><ArrowUp size={16} /></button>
      <button type="button" aria-label="次の検索結果" title="次の検索結果" disabled={context.busy || !context.results.length} onClick={() => void context.next()}><ArrowDown size={16} /></button>
      <button type="button" aria-label="検索を閉じる" title="検索を閉じる" onClick={context.close}><X size={16} /></button>
    </div>
    {context.externalAvailable && <div className="lxte-result-search-modes" role="group" aria-label="検索方法"><button type="button" aria-pressed={context.mode === "local"} onClick={() => context.openSearch()}>文字列</button><button type="button" aria-pressed={context.mode === "external"} onClick={() => context.openExternalSearch()}>外部検索結果</button></div>}
    {context.error && <p className="lxte-result-search-error" role="alert">{context.error}</p>}
    <div className="lxte-result-search-list" role="list" aria-label="検索結果">
      {context.results.map((result, index) => <div role="listitem" key={result.id}><button type="button" aria-current={result.id === context.activeResultId ? "true" : undefined} onClick={() => void context.selectResult(result.id)}>
        <span className="lxte-result-search-result-title">{result.title || result.locationLabel || `結果 ${index + 1}`}</span>
        {result.title && result.locationLabel && <small>{result.locationLabel}</small>}
        {result.snippet && <span className="lxte-result-search-snippet">{result.snippet}</span>}
      </button></div>)}
      {!context.results.length && !context.busy && !context.error && <p className="lxte-result-search-empty">{context.mode === "local" && !context.query.query ? "検索する文字列を入力" : "結果がありません"}</p>}
    </div>
  </section>;
}
