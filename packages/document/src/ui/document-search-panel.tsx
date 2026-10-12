import { useLayoutEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { DocumentEditor } from "../state/use-document-editor";

export function DocumentSearchPanel({ editor, onClose, hidden = false }: { editor: DocumentEditor; onClose(): void; hidden?: boolean }) {
  const input = useRef<HTMLInputElement>(null), active = useRef<HTMLButtonElement>(null), externalActive = useRef<HTMLButtonElement>(null), search = editor.search;
  const externalFocus = useRef("");
  const start = Math.floor(Math.max(0, search.index) / 100) * 100;
  useLayoutEffect(() => { if (!hidden && search.mode === "local") { input.current?.focus(); input.current?.select(); } }, [search.focus, search.mode, hidden]);
  useLayoutEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [search.index]);
  useLayoutEffect(() => {
    const intent = `${search.focus}:${search.external.index}:${search.mode}`;
    if (hidden || search.mode !== "external" || externalFocus.current === intent) return;
    externalFocus.current = intent;
    externalActive.current?.focus?.({ preventScroll: true }); externalActive.current?.scrollIntoView?.({ block: "nearest" });
  }, [search.external.index, search.focus, search.mode, hidden]);
  return <aside hidden={hidden} className="lxd-search-panel" aria-label={search.mode === "external" ? "外部検索結果" : "文書内を検索"} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="lxd-search-heading"><h2>{search.mode === "external" ? search.external.title : "検索"}</h2><button type="button" aria-label="検索を閉じる" onClick={onClose}><X size={17} /></button></div>
    {search.external.available && <div className="lxd-search-modes"><button type="button" aria-pressed={search.mode === "external"} onClick={() => search.openExternalSearch()}>外部検索結果</button><button type="button" aria-pressed={search.mode === "local"} onClick={() => search.openSearch(search.query)}>文書内を検索</button></div>}
    {search.mode === "external" && !search.external.available && <button type="button" onClick={() => search.openSearch(search.query)}>文書内を検索</button>}
    <div hidden={search.mode !== "external"} className="lxd-search-external">
      <div className="lxd-search-controls"><span role="status" aria-live="polite">{search.external.results.length ? `${Math.max(0, search.external.index + 1)} / ${search.external.results.length} 件` : "検索結果はありません"}</span>
        <button type="button" aria-label="前の外部検索結果" disabled={!search.external.results.length} onClick={() => search.goToExternal(search.external.index - 1)}><ChevronUp size={17} /></button>
        <button type="button" aria-label="次の外部検索結果" disabled={!search.external.results.length} onClick={() => search.goToExternal(search.external.index + 1)}><ChevronDown size={17} /></button>
        <button type="button" className="lxd-search-return" disabled={search.external.index < 0} onClick={() => search.goToExternal(search.external.index)}>選択した結果に戻る</button>
      </div>
      {search.externalError && <p role="alert">{search.externalError}</p>}
      <div className="lxd-search-results">{search.external.results.map((row, index) => <button type="button" key={row.result.id} ref={index === search.external.index ? externalActive : undefined} aria-current={index === search.external.index ? "true" : undefined} onClick={() => search.goToExternal(index)}>
        <span>{row.result.locationLabel ?? row.result.target.blockId}</span><strong>{row.result.title ?? `検索結果 ${index + 1}`}</strong>{row.result.snippet && <p>{row.result.snippet}</p>}{row.error && <p>{row.error}</p>}
      </button>)}</div>
    </div>
    <div hidden={search.mode !== "local"} className="lxd-search-local">
    <form role="search" onSubmit={event => { event.preventDefault(); search.goTo(search.index + 1); }}>
      <label className="lxd-search-input"><Search size={16} /><input ref={input} aria-label="検索する文字列" placeholder="文書内を検索" maxLength={4096} value={search.query} onChange={event => search.setQuery(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); search.goTo(search.index + (event.shiftKey ? -1 : 1)); }
      }} /></label>
      <label className="lxd-search-option"><input type="checkbox" checked={search.caseSensitive} onChange={event => search.setCaseSensitive(event.currentTarget.checked)} />大文字・小文字を区別</label>
    </form>
    <div className="lxd-search-controls"><span role="status" aria-live="polite">{search.error || (!search.query.trim() ? "検索語を入力してください" : search.index < 0 ? "一致する結果はありません" : `${search.index + 1} / ${search.locations.length}${search.truncated ? "+" : ""} 件`)}</span>
      <button type="button" aria-label="前の検索結果" disabled={search.index < 0} onClick={() => search.goTo(search.index - 1)}><ChevronUp size={17} /></button><button type="button" aria-label="次の検索結果" disabled={search.index < 0} onClick={() => search.goTo(search.index + 1)}><ChevronDown size={17} /></button>
    </div>
    <div className="lxd-search-results">{search.locations.slice(start, start + 100).map((location, offset) => <button type="button" ref={start + offset === search.index ? active : undefined} key={`${location.blockId}:${location.canvasShapeId ?? ""}:${location.match.textFrom}`} aria-current={start + offset === search.index ? "true" : undefined} onClick={() => search.goTo(start + offset)}>
      <span>{location.kind === "shape" || location.kind === "canvas-shape" ? "図形" : "本文"}</span>
      <p>{location.match.textFrom > 35 && "…"}{location.text.slice(Math.max(0, location.match.textFrom - 35), location.match.textFrom)}<mark>{location.text.slice(location.match.textFrom, location.match.textTo)}</mark>{location.text.slice(location.match.textTo, location.match.textTo + 65)}{location.text.length > location.match.textTo + 65 && "…"}</p>
    </button>)}{search.locations.length > 100 && <p className="lxd-search-hint">100件ずつ表示しています。前へ・次へですべての検索結果へ移動できます。</p>}{search.truncated && <p className="lxd-search-hint">結果が多いため、検索語を絞り込んでください。</p>}</div>
    </div>
  </aside>;
}
