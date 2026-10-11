"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { PdfSearch, PdfSearchHit } from "./use-pdf-search";
import type { PdfSession } from "./use-pdf-document";

const PAGE_SIZE = 100;
function Snippet({ hit }: { hit: PdfSearchHit }) {
  const start = Math.max(0, hit.from - 35), end = Math.min(hit.page.text.length, hit.to + 65);
  return <span className="lxp-search-snippet">{start > 0 ? "…" : ""}{hit.page.text.slice(start, hit.from)}<mark>{hit.page.text.slice(hit.from, hit.to)}</mark>{hit.page.text.slice(hit.to, end)}{end < hit.page.text.length ? "…" : ""}</span>;
}

export function PdfSearchPanel({ search, session, loadError, navigationLocked, onClose }: {
  search: PdfSearch; session: PdfSession | undefined; loadError?: Error; navigationLocked: boolean; onClose(): void;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null);
  const result = search.result, hits = result?.hits ?? [], index = result?.index ?? -1;
  const unsupported = !!session && !session.getPageText;
  const loading = !loadError && !session;
  const searching = !loadError && !!session && !unsupported && !!search.query && !result;
  const error = loadError?.message ?? result?.error;
  const disabled = navigationLocked || !hits.length;
  const start = Math.floor(Math.max(0, index) / PAGE_SIZE) * PAGE_SIZE;
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [search.focus]);
  useEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [index]);
  return <aside className="lxp-search-panel" aria-labelledby={`${id}-heading`} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="lxp-search-heading"><h2 id={`${id}-heading`}>検索</h2><button type="button" aria-label="検索を閉じる" onClick={onClose}><X size={17} /></button></div>
    <div className="lxp-search-controls">
      <div className="lxp-search-input"><Search size={16} aria-hidden="true" /><input ref={input} type="text" aria-label="検索する文字列" placeholder="PDF内を検索" maxLength={4096} value={search.query}
        onChange={event => search.setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && !disabled) {
            event.preventDefault(); search.navigate(index + (event.shiftKey ? -1 : 1));
          }
        }} /></div>
      <label className="lxp-search-option"><input type="checkbox" checked={search.matchCase} onChange={event => search.setMatchCase(event.target.checked)} />大文字と小文字を区別</label>
      <div className="lxp-search-navigation"><span role="status" aria-live="polite">{loading ? "PDFを読み込んでいます…" : searching ? "検索しています…" : !search.query ? "検索する文字列を入力" : error || unsupported ? "検索できません" : `${Math.max(0, index + 1)} / ${hits.length} 件${result?.truncated ? "以上" : ""}`}</span>
        <button type="button" aria-label="前の検索結果" title="前へ (Shift+Enter)" disabled={disabled} onClick={() => search.navigate(index < 0 ? hits.length - 1 : index - 1)}><ChevronUp size={17} /></button>
        <button type="button" aria-label="次の検索結果" title="次へ (Enter)" disabled={disabled} onClick={() => search.navigate(index + 1)}><ChevronDown size={17} /></button>
      </div>
      {unsupported && <p className="lxp-search-empty" role="status">このPDFローダーは文字検索に対応していません。文字情報の取得に対応したローダーを指定してください。</p>}
      {error && <p className="lxp-search-error" role="alert">{error}</p>}
      {search.query && result && !error && !hits.length && <p className="lxp-search-empty">一致する文字列はありません。画像だけのPDFは検索できません。</p>}
      {result?.truncated && <p className="lxp-search-empty">結果が多いため一部を表示しています。検索する文字列を絞ってください。</p>}
    </div>
    <div className="lxp-search-results" aria-label="検索結果">
      {hits.slice(start, start + PAGE_SIZE).map((hit, offset) => {
        const position = start + offset;
        return <button type="button" key={`${hit.page.pageNumber}:${hit.from}`} ref={position === index ? active : undefined} className="lxp-search-result"
          aria-current={position === index ? "true" : undefined} disabled={navigationLocked} onClick={() => search.navigate(position)}>
          <span className="lxp-search-location">ページ {hit.page.pageNumber}</span><Snippet hit={hit} />
        </button>;
      })}
    </div>
  </aside>;
}
