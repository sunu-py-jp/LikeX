import { useCallback, useMemo, useRef, useState } from "react";
import Explorer, { type ExplorerSearchHandler, type ExplorerSearchRenderer } from "@likex/explorer";
import { createTextSearchMatcher } from "@likex/core/text-search";
import { SearchDemoControl, SearchDemoFrame, searchDemoPattern, type SearchDemoTrace, type SearchDemoTrigger } from "./demo/search-demo";
import { createSearchEntries } from "./demo/search-samples";
import { createMeetingSearchEntries, meetingSearchFile, searchMeetingMinutes, streamMeetingSearchResults, type MeetingSearchFilters } from "./demo/meeting-search";
import { MeetingSearchControl, renderMeetingSearchResult } from "./demo/meeting-search-ui";
import "../../../packages/explorer/src/styles.css";

const renderSearch: ExplorerSearchRenderer = context => <SearchDemoControl
  input={<input {...context.inputProps} placeholder={context.conditions.useRegex ? "例：^Report / C\\+\\+" : "例：Report / C++"} maxLength={context.conditions.useRegex ? 4096 : 100_000} aria-label="検索する文字列" />}
  text={context.query} matchCase={context.conditions.matchCase} wholeText={context.conditions.wholeName} useRegex={context.conditions.useRegex} searching={context.searching} error={context.error} disabled={context.inputProps.disabled}
  onMatchCase={matchCase => context.setConditions({ matchCase })}
  onWholeText={wholeName => context.setConditions({ wholeName })}
  onUseRegex={useRegex => context.setConditions({ useRegex })}
  submit={context.submit} clear={context.clear}
/>;

export default function ExplorerSearchDemo() {
  const [nameEntries] = useState(createSearchEntries), [meetingEntries] = useState(createMeetingSearchEntries), [trigger, setTrigger] = useState<SearchDemoTrigger>("input");
  const [mode, setMode] = useState<"names" | "minutes">("names");
  const [filters, setFilters] = useState<MeetingSearchFilters>({ customerName: "", dateFrom: "", dateTo: "" });
  const [incremental, setIncremental] = useState(true);
  const entries = mode === "minutes" ? meetingEntries : nameEntries;
  const params = useMemo(() => ({ mode, ...(mode === "minutes" ? { ...filters, incremental } : {}) }), [mode, filters, incremental]);
  const [trace, setTrace] = useState<SearchDemoTrace | null>(null), sequence = useRef(0);
  const search = useCallback<ExplorerSearchHandler>((request, { signal }) => {
    signal.throwIfAborted();
    if (request.params?.mode === "minutes") {
      const hits = searchMeetingMinutes(request.entries, request.query, request.params);
      const trace = { sequence: ++sequence.current, query: request.query, matchCase: false, wholeText: false, useRegex: false,
        pattern: searchDemoPattern(request.query), scope: "議事録本文・顧客・会議日" };
      setTrace({ ...trace, count: request.params.incremental ? 0 : hits.length });
      if (request.params.incremental) return (async function* () {
        let count = 0;
        for await (const batch of streamMeetingSearchResults(hits, signal)) {
          signal.throwIfAborted();
          count += batch.length;
          setTrace({ ...trace, count });
          yield batch;
        }
      })();
      return hits;
    }
    const { matchCase, wholeName, useRegex } = request.conditions;
    const matcher = createTextSearchMatcher({ text: request.query, matchCase, wholeText: wholeName, useRegex });
    const ids = request.entries.filter(entry => matcher.test(entry.name)).map(entry => entry.id);
    setTrace({ sequence: ++sequence.current, query: request.query, matchCase, wholeText: wholeName, useRegex, count: ids.length,
      pattern: searchDemoPattern(request.query, matchCase, wholeName, useRegex), scope: "ファイル・フォルダ名" });
    return ids;
  }, []);
  const render = useCallback<ExplorerSearchRenderer>(context => mode === "minutes" ? <MeetingSearchControl context={context} filters={filters} onFilters={setFilters} incremental={incremental} onIncremental={setIncremental} /> : renderSearch(context), [mode, filters, incremental]);
  const introduction = <><div className="meeting-search-mode" role="group" aria-label="検索サンプルの種類">{([ ["names", "ファイル名"], ["minutes", "議事録の本文"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setTrace(null); }}>{label}</button>)}</div>
    <p>{mode === "minutes" ? "顧客・会議日・本文のキーワードから議事録を探します。会議日や抜粋は、利用側が定義した結果表示です。" : "右上の検索欄を試してください。名前と一致したファイルが表示されます。"}</p></>;
  const meetingExamples = mode === "minutes" ? <div className="search-demo-examples meeting-search-guide"><h3>例：9月の料金改定の会議</h3><p>検索欄の「例を入力」で、東雲製作所・9月・料金改定をセットできます。</p><p>「見つかった順に表示」は1件ずつ届く様子を再現します。短い待機はデモ用で、通信は行いません。</p><p>9月12日の会議録は10月3日に更新されています。絞り込みには<strong>会議日</strong>を使います。</p><p>本文キーワードは必須です。空にすると通常のファイル一覧へ戻ります。</p><p>これは業務フィルターと本文検索のデモです。自然言語の依頼を解釈する場合は、利用側の外部検索APIやLLMを接続します。このデモはLLMを呼び出しません。</p></div> : undefined;
  return <SearchDemoFrame kind="explorer" trigger={trigger} onTrigger={setTrigger} trace={trace} introduction={introduction} examples={meetingExamples}>
    <Explorer key={mode} title={mode === "minutes" ? "顧客との会議議事録" : "名前の検索サンプル"} initialEntries={entries} colorMode="light"
      search={{ trigger, debounceMs: 180, params, resultDetailsHeight: mode === "minutes" ? 192 : 72 }} renderSearch={render} onSearchRequest={search} renderSearchResult={mode === "minutes" ? renderMeetingSearchResult : undefined}
      onSave={payload => [...payload.entries]} readFile={async id => new Blob([mode === "minutes" ? meetingSearchFile(id) : entries.find(entry => entry.id === id)?.name ?? "検索サンプル"], { type: "text/plain" })}
      features={{ uploadFiles: false, uploadFolders: false, createFile: false, createFolder: false, favorites: false }}
      view={{ defaultMode: "details" }} style={{ height: "100%", border: 0, borderRadius: 0 }} />
  </SearchDemoFrame>;
}
