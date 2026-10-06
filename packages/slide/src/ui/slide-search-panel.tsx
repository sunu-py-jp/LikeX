"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { searchSlides, type SlideSearchMatch } from "../model/search";
import type { SlideEditor } from "../state/use-slide-editor";

type Hit = { field: SlideSearchMatch; from: number; to: number };
const PAGE_SIZE = 100;

function Snippet({ hit }: { hit: Hit }) {
  const start = Math.max(0, hit.from - 35), end = Math.min(hit.field.text.length, hit.to + 65);
  return <span className="lxp-search-snippet">{start > 0 ? "…" : ""}{hit.field.text.slice(start, hit.from)}<mark>{hit.field.text.slice(hit.from, hit.to)}</mark>{hit.field.text.slice(hit.to, end)}{end < hit.field.text.length ? "…" : ""}</span>;
}

/** View-only navigation; content matching always uses the public headless API. */
export function SlideSearchPanel({ editor, onClose }: { editor: SlideEditor; onClose(): void }) {
  const id = useId(), input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null);
  const [matchCase, setMatchCase] = useState(false);
  const { query, focusVersion } = editor.search;
  const deck = editor.deck, select = editor.selectSearchMatch, highlight = editor.highlightSearchMatch;
  const lastIntent = useRef("");
  const result = useMemo(() => {
    if (!query) return { hits: [] as Hit[], truncated: false, error: "" };
    try {
      const found = searchSlides(deck, { keywords: [query], matchCase });
      return { hits: found.matches.flatMap(field => field.matches.map(({ from, to }) => ({ field, from, to }))), truncated: found.truncated, error: "" };
    } catch (error) { return { hits: [] as Hit[], truncated: false, error: error instanceof Error ? error.message : "検索できませんでした。" }; }
  }, [deck, query, matchCase]);
  const intent = JSON.stringify([query, matchCase, focusVersion]);
  const [navigation, setNavigation] = useState<{ result: typeof result | null; index: number; intent: string }>({ result: null, index: -1, intent: "" });
  const previous = navigation.intent === intent ? navigation.result?.hits[navigation.index] : undefined, previousField = previous?.field ?? editor.searchMatch;
  const sameField = (hit: Hit) => previousField?.slideId === hit.field.slideId && previousField.owner === hit.field.owner && previousField.elementId === hit.field.elementId;
  const exact = result.hits.findIndex(hit => sameField(hit) && hit.from === previous?.from);
  const retained = exact >= 0 ? exact : result.hits.findIndex(sameField);
  const index = navigation.result === result && navigation.intent === intent ? navigation.index : retained >= 0 ? retained : result.hits.length ? 0 : -1;
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusVersion]);
  useEffect(() => {
    if (lastIntent.current !== intent) {
      // A pending input may delay this request, but content changes after a
      // completed search never move the user's current page or selection.
      if (select(result.hits[0]?.field ?? null, deck)) lastIntent.current = intent;
      return;
    }
    highlight(result.hits[index]?.field ?? null, deck);
  }, [result, deck, select, highlight, intent, index, editor.busy, editor.requesting, editor.dirty]);
  useEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [index]);
  const navigate = (next: number) => {
    if (!result.hits.length) return;
    const target = (next + result.hits.length) % result.hits.length;
    if (select(result.hits[target].field, deck)) setNavigation({ result, index: target, intent });
  };
  const blocked = !!editor.busy || editor.requesting;
  const start = Math.floor(Math.max(0, index) / PAGE_SIZE) * PAGE_SIZE;
  return <aside data-slide-view-only="" className="lxp-search-panel" aria-labelledby={`${id}-heading`} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="lxp-search-heading"><h2 id={`${id}-heading`}>検索</h2><button type="button" aria-label="検索を閉じる" onClick={onClose}><X size={17} /></button></div>
    <div className="lxp-search-controls">
      <div className="lxp-search-input"><Search size={16} aria-hidden="true" /><input ref={input} type="text" aria-label="検索する文字列" placeholder="スライド内を検索" maxLength={4096} value={query}
        onChange={event => editor.setSearchQuery(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && !blocked) { event.preventDefault(); navigate(index + (event.shiftKey ? -1 : 1)); }
        }} /></div>
      <label className="lxp-search-option"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} />大文字と小文字を区別</label>
      <div className="lxp-search-navigation"><span role="status" aria-live="polite">{!query ? "検索する文字列を入力" : `${Math.max(0, index + 1)} / ${result.hits.length} 件${result.truncated ? "以上" : ""}`}</span>
        <button type="button" aria-label="前の検索結果" title="前へ (Shift+Enter)" disabled={blocked || !result.hits.length} onClick={() => navigate(index < 0 ? result.hits.length - 1 : index - 1)}><ChevronUp size={17} /></button>
        <button type="button" aria-label="次の検索結果" title="次へ (Enter)" disabled={blocked || !result.hits.length} onClick={() => navigate(index + 1)}><ChevronDown size={17} /></button>
      </div>
      {result.error && <p className="lxp-search-error" role="alert">{result.error}</p>}
      {query && !result.error && !result.hits.length && <p className="lxp-search-empty">一致する文字列はありません。</p>}
      {result.truncated && <p className="lxp-search-empty">結果が多いため一部を表示しています。検索する文字列を絞ってください。</p>}
    </div>
    <div className="lxp-search-results" aria-label="検索結果">
      {result.hits.slice(start, start + PAGE_SIZE).map((hit, offset) => {
        const position = start + offset;
        return <button type="button" key={`${hit.field.slideId}:${hit.field.owner}:${hit.field.elementId}:${hit.from}`} ref={position === index ? active : undefined} className="lxp-search-result"
          aria-current={position === index ? "true" : undefined} disabled={blocked} onClick={() => navigate(position)}>
          <span className="lxp-search-location">スライド {hit.field.pageNumber}{hit.field.owner !== "slide" ? " · マスター／レイアウト" : ""}</span><Snippet hit={hit} />
        </button>;
      })}
    </div>
  </aside>;
}
