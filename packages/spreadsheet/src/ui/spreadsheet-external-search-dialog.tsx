"use client";

import { useCallback, type RefObject } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { resolveExternalSearchTarget } from "../state/external-search-target";
import { SpreadsheetFloatingWindow, type SpreadsheetFloatingWindowFrame } from "./spreadsheet-floating-window";

export function SpreadsheetExternalSearchDialog({ controller: c, frameRef }: {
  controller: SpreadsheetController; frameRef?: RefObject<SpreadsheetFloatingWindowFrame | null>;
}) {
  const results = c.externalSearchResults, selected = c.searchPanel.externalResultId;
  const selectedIndex = results.findIndex(result => result.id === selected);
  const selectedButton = useCallback((button: HTMLButtonElement | null) => {
    const view = button?.ownerDocument.defaultView;
    if (!button || !view) return;
    // The floating portal mounts after this component. Wait for its frame layout,
    // and reveal on attachment/selection only so ordinary renders preserve manual scroll.
    const frame = view.requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
    return () => view.cancelAnimationFrame(frame);
  }, []);
  const locked = !!c.editing || c.pendingObjectEdit;
  const navigate = (direction: -1 | 1) => {
    if (locked || !results.length) return;
    const index = selectedIndex < 0 ? direction === 1 ? 0 : results.length - 1 : (selectedIndex + direction + results.length) % results.length;
    c.chooseExternalSearchResult(results[index].id);
  };
  return <SpreadsheetFloatingWindow title={c.externalSearch?.title?.trim() || "外部検索結果"} frameRef={frameRef}
    onClose={c.closeSearch} className="lxs-search-dialog lxs-external-search-dialog"
    onKeyDown={event => {
      if (!event.altKey && !event.shiftKey && event.ctrlKey !== event.metaKey && event.key.toLowerCase() === "f" && c.openLocalSearch()) event.preventDefault();
    }} actions={<>
      <button type="button" disabled={locked || !results.length} onClick={() => navigate(-1)}>前の結果</button>
      <button type="button" disabled={locked || !results.length} onClick={() => navigate(1)}>次の結果</button>
      <button type="button" disabled={locked || selectedIndex < 0} onClick={() => selected && c.chooseExternalSearchResult(selected)}>選択した結果に戻る</button>
    </>}>
    <div className="lxs-search-source"><button type="button" onClick={c.openLocalSearch}>文書内を検索</button></div>
    <p role="status">{results.length ? `${selectedIndex >= 0 ? `${selectedIndex + 1} / ` : ""}${results.length} 件` : "外部検索結果はありません。"}</p>
    {c.searchPanel.externalError && <p role="alert">{c.searchPanel.externalError}</p>}
    {selected !== null && selectedIndex < 0 && <p role="status">選択した結果は現在の一覧にありません。</p>}
    {results.length > 0 && <div className="lxs-search-results lxs-external-search-results" role="list" aria-label="外部検索結果"
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); navigate(event.key === "ArrowDown" ? 1 : -1); }
      }}>
      {results.map(result => {
        const valid = resolveExternalSearchTarget(c.workbook, result.target);
        const sheet = valid && c.workbook.sheets.find(item => item.id === valid.sheetId);
        const location = result.locationLabel ?? (sheet ? `${sheet.name}!${result.target.range}` : "移動先が見つかりません");
        return <button key={result.id} ref={result.id === selected ? selectedButton : undefined} type="button" role="listitem" disabled={locked}
          aria-current={result.id === selected ? "true" : undefined} onClick={() => c.chooseExternalSearchResult(result.id)}>
          <span className="lxs-external-search-location">{location}</span>
          {result.title && <strong>{result.title}</strong>}
          {result.snippet && <span className="lxs-external-search-snippet">{result.snippet}</span>}
        </button>;
      })}
    </div>}
  </SpreadsheetFloatingWindow>;
}
