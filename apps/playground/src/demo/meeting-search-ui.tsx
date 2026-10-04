import { useId } from "react";
import type { ExplorerSearchRenderContext, ExplorerSearchResultRenderer } from "@likex/explorer";
import { meetingSearchCustomers, meetingSearchExample, type MeetingSearchFilters } from "./meeting-search";
import "./meeting-search.css";

export function MeetingSearchControl({ context, filters, onFilters, incremental, onIncremental }: {
  context: ExplorerSearchRenderContext; filters: MeetingSearchFilters; onFilters(value: MeetingSearchFilters): void;
  incremental: boolean; onIncremental(value: boolean): void;
}) {
  const keywordId = useId();
  return <div className="search-demo-control meeting-search-control">
    <label className="meeting-search-keyword-label" htmlFor={keywordId}>本文キーワード <span>必須</span></label>
    <div className="search-demo-input"><input {...context.inputProps} id={keywordId} placeholder="例：料金改定" aria-label="議事録の本文キーワード" maxLength={100_000} />
      <button type="button" disabled={!context.query.trim()} onClick={context.submit}>検索</button><button type="button" onClick={() => { context.clear(); onFilters({ customerName: "", dateFrom: "", dateTo: "" }); }}>クリア</button></div>
    <div className="meeting-search-filters"><label>顧客<select aria-label="議事録の顧客" value={filters.customerName} onChange={event => onFilters({ ...filters, customerName: event.target.value })}><option value="">すべての顧客</option>{meetingSearchCustomers.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>会議日・開始<input type="date" aria-label="会議日の開始日" value={filters.dateFrom} onChange={event => onFilters({ ...filters, dateFrom: event.target.value })} /></label>
      <label>会議日・終了<input type="date" aria-label="会議日の終了日" value={filters.dateTo} onChange={event => onFilters({ ...filters, dateTo: event.target.value })} /></label></div>
    <button type="button" className="meeting-search-example" onClick={() => { const { keyword, ...values } = meetingSearchExample; onFilters(values); context.setQuery(keyword); }}>例を入力：東雲製作所・9月・料金改定</button>
    <label className="meeting-search-incremental"><input type="checkbox" checked={incremental} onChange={event => onIncremental(event.target.checked)} />見つかった順に表示</label>
    <p className="search-demo-regex-note">会議日は議事録の業務情報です。ファイルの更新日では絞り込みません。{context.trigger === "submit" ? "Enter または検索ボタンで実行します。" : "入力すると検索します。"}</p>
    {context.searching && <span role="status">検索中… 見つかった結果から表示しています。</span>}
    {context.error && <p role="alert" className="search-demo-error">{context.error}</p>}
  </div>;
}

/** Only the supplemental result content is replaced; the library owns file actions. */
export const renderMeetingSearchResult: ExplorerSearchResultRenderer = ({ entry, hit }) => {
  const customer = hit.metadata?.customerName, meetingDate = hit.metadata?.meetingDate;
  if (typeof customer !== "string" || typeof meetingDate !== "string") return undefined;
  return <div className="meeting-search-hit">
    <div className="meeting-search-hit-meta"><span className="meeting-search-customer">{customer}</span><span>会議日 <time dateTime={meetingDate}>{meetingDate}</time></span><span className="meeting-search-updated">ファイル更新 {entry.updatedAt.slice(0, 10)}</span></div>
    {hit.snippet && <p className="meeting-search-snippet">{hit.snippet}</p>}
    {hit.reason && <p className="meeting-search-reason">{hit.reason}</p>}
  </div>;
};
