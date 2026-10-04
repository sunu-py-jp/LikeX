import { useCallback, useRef, useState } from "react";
import Spreadsheet, { findSpreadsheetCells, type SpreadsheetSearchHandler, type SpreadsheetSearchRenderContext } from "@likex/spreadsheet";
import { SearchDemoControl, SearchDemoFrame, searchDemoPattern, type SearchDemoTrace, type SearchDemoTrigger } from "./demo/search-demo";
import { createSearchWorkbook } from "./demo/search-samples";
import "../../../packages/spreadsheet/src/styles.css";

function renderSearch(context: SpreadsheetSearchRenderContext, trigger: SearchDemoTrigger, onTrigger: (trigger: SearchDemoTrigger) => void) {
  return <SearchDemoControl input={context.defaultInput} text={context.query.text} matchCase={context.query.matchCase ?? false} wholeText={context.query.wholeCell ?? false} useRegex={context.query.useRegex ?? false} searching={context.searching} disabled={context.disabled}
    onMatchCase={matchCase => context.setQuery({ ...context.query, matchCase })}
    onWholeText={wholeCell => context.setQuery({ ...context.query, wholeCell })}
    onUseRegex={useRegex => context.setQuery({ ...context.query, useRegex })}
    submit={context.submit} clear={context.clear}>
    <div className="search-demo-sheet-options"><label>実行タイミング<select aria-label="検索を実行するタイミング" value={trigger} onChange={event => onTrigger(event.target.value as SearchDemoTrigger)}><option value="input">入力時</option><option value="submit">Enter・検索ボタン</option></select></label><label>検索範囲<select value={context.scope} disabled={context.disabled} onChange={event => context.setScope(event.target.value as "sheet" | "workbook")}><option value="sheet">現在のシート</option><option value="workbook">ブック全体</option></select></label>
      <label>検索対象<select value={context.query.lookIn ?? "values"} disabled={context.disabled} onChange={event => context.setQuery({ ...context.query, lookIn: event.target.value as "values" | "formulas" })}><option value="values">表示値</option><option value="formulas">数式・入力値</option></select></label></div>
    {context.mode === "replace" && context.defaultReplacement}
  </SearchDemoControl>;
}

export default function SpreadsheetSearchDemo() {
  const [workbook] = useState(createSearchWorkbook), [trigger, setTrigger] = useState<SearchDemoTrigger>("input");
  const [trace, setTrace] = useState<SearchDemoTrace | null>(null), sequence = useRef(0);
  const search = useCallback<SpreadsheetSearchHandler>((request, { signal }) => {
    signal.throwIfAborted();
    const matches = findSpreadsheetCells(request.workbook, request.query, { sheetId: request.sheetId });
    const matchCase = request.query.matchCase ?? false, wholeText = request.query.wholeCell ?? false, useRegex = request.query.useRegex ?? false;
    setTrace({ sequence: ++sequence.current, query: request.query.text, matchCase, wholeText, useRegex, count: matches.length,
      pattern: searchDemoPattern(request.query.text, matchCase, wholeText, useRegex), scope: request.scope === "workbook" ? "ブック全体" : "現在のシート" });
    return matches;
  }, []);
  const render = useCallback((context: SpreadsheetSearchRenderContext) => renderSearch(context, trigger, setTrigger), [trigger]);
  return <SearchDemoFrame kind="spreadsheet" trigger={trigger} onTrigger={setTrigger} trace={trace}>
    <Spreadsheet initialWorkbook={workbook} title="セルの検索サンプル" colorMode="light" onSave={value => value}
      search={{ trigger, debounceMs: 180 }} renderSearch={render} onSearchRequest={search}
      style={{ height: "100%", width: "100%" }} aria-label="検索サンプルスプレッドシート" />
  </SearchDemoFrame>;
}
