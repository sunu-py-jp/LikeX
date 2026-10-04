"use client";

import { useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import { chainResult } from "../core";
import type { SpreadsheetSearchMatch } from "../api/editing-commands";
import type { SpreadsheetCommand } from "../api/types";
import { parseCellAddress } from "../model/address";
import { findSpreadsheetCells, validateSpreadsheetSearchMatches } from "../model/editing/search";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { useSpreadsheetSearch } from "../state/use-spreadsheet-search";
import { SpreadsheetDialog } from "./spreadsheet-dialog";

export function SpreadsheetSearchDialog({ controller: c, initialMode, onClose }: {
  controller: SpreadsheetController; initialMode: "find" | "replace"; onClose: () => void;
}) {
  const first = useRef<HTMLInputElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const search = useSpreadsheetSearch(c, initialMode);
  const { query, setQuery, scope, setScope, replacement, setReplacement, results: matches, searching, error } = search;
  const latest = useRef(search);
  useInsertionEffect(() => { latest.current = search; });
  const feedbackKey = useMemo(() => ({ query, scope }), [query, scope]);
  const [feedback, setFeedback] = useState<{ key: typeof feedbackKey; selected: SpreadsheetSearchMatch | null; message: string }>(
    { key: feedbackKey, selected: null, message: "" });
  const currentFeedback = feedback.key === feedbackKey ? feedback : null;
  const selected = currentFeedback?.selected ?? null, message = currentFeedback?.message ?? "";
  const updateFeedback = (patch: Partial<Pick<typeof feedback, "selected" | "message">>) => setFeedback(previous => ({ key: feedbackKey,
    selected: previous.key === feedbackKey ? previous.selected : null,
    message: previous.key === feedbackKey ? previous.message : "", ...patch }));
  const setSelected = (value: SpreadsheetSearchMatch | null) => updateFeedback({ selected: value });
  const setMessage = (value: string) => updateFeedback({ message: value });
  const [busy, setBusy] = useState(false);
  const selectedIndex = matches.findIndex(match => match.address === selected?.address && match.sheetId === selected.sheetId);
  const replacing = initialMode === "replace" && c.features.replace && !c.readOnly;
  const locked = busy || c.requesting || c.saving || c.refreshing;
  const choose = (match: SpreadsheetSearchMatch) => {
    if (locked || searching || error) return;
    setSelected(match); setMessage("");
    c.selectCellInSheet(match.sheetId, parseCellAddress(match.address)!);
  };
  const navigate = (direction: 1 | -1) => {
    if (!matches.length) { setMessage("一致するセルがありません"); return; }
    const index = selectedIndex < 0 ? direction === 1 ? 0 : matches.length - 1 : (selectedIndex + direction + matches.length) % matches.length;
    choose(matches[index]);
  };
  const replace = (all: boolean) => {
    if (!replacing || c.disabled || locked || searching || search.pending || error || !query.text) return;
    const source = c.getWorkbook(), sheetId = scope === "sheet" ? c.activeSheet.id : undefined;
    let targets: readonly SpreadsheetSearchMatch[];
    try {
      const candidates = all ? matches : selectedIndex >= 0 ? [matches[selectedIndex]] : matches.slice(0, 1);
      const valid = validateSpreadsheetSearchMatches(source, query, candidates, { sheetId });
      const local = findSpreadsheetCells(source, query, { sheetId });
      const localAddresses = new Map<string, Set<string>>();
      for (const match of local) { const addresses = localAddresses.get(match.sheetId) ?? new Set<string>(); addresses.add(match.address); localAddresses.set(match.sheetId, addresses); }
      targets = valid.filter(match => localAddresses.get(match.sheetId)?.has(match.address));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "再検索してください"); return; }
    if (!targets.length) { setMessage("置換するセルがありません"); return; }
    const groups = new Map<string, string[]>();
    for (const match of targets) { const addresses = groups.get(match.sheetId) ?? []; addresses.push(match.address); groups.set(match.sheetId, addresses); }
    const commands: SpreadsheetCommand[] = [...groups].map(([sheetId, addresses]) => ({ type: "cells.replace", sheetId, query, replacement, addresses }));
    setBusy(true);
    void chainResult(c.executeCommands(commands, { isCurrent: () => mounted.current && c.getWorkbook() === source && latest.current.query === query && latest.current.scope === scope && latest.current.results === matches }), result => {
      if (!mounted.current) return;
      setBusy(false);
      if (result.ok) { setMessage(`${targets.length}個のセルを置換しました`); setSelected(null); }
      else setMessage(result.message);
    });
  };
  const defaultInput = <label>検索する文字列<input ref={first} value={query.text} maxLength={query.useRegex ? 4096 : 100_000} disabled={locked}
    onCompositionStart={search.onCompositionStart} onCompositionEnd={search.onCompositionEnd}
    onChange={event => setQuery({ ...query, text: event.target.value })} /></label>;
  const defaultReplacement = replacing ? <label>置換後の文字列<input value={replacement} maxLength={100_000} disabled={locked} onChange={event => setReplacement(event.target.value)} /></label> : null;
  const defaultOptions = <>
    <div className="lxs-search-options"><label>検索範囲<select value={scope} disabled={locked} onChange={event => setScope(event.target.value as "sheet" | "workbook")}><option value="sheet">現在のシート</option>{c.features.sheets && <option value="workbook">ブック全体</option>}</select></label>
      <label>検索対象<select value={query.lookIn ?? "values"} disabled={locked} onChange={event => setQuery({ ...query, lookIn: event.target.value as "values" | "formulas" })}><option value="values">表示値</option><option value="formulas">数式・入力値</option></select></label></div>
    <label className="lxs-search-checkbox"><input type="checkbox" checked={!!query.matchCase} disabled={locked} onChange={event => setQuery({ ...query, matchCase: event.target.checked })} />大文字と小文字を区別する</label>
    <label className="lxs-search-checkbox"><input type="checkbox" checked={!!query.wholeCell} disabled={locked} onChange={event => setQuery({ ...query, wholeCell: event.target.checked })} />セルの内容全体と一致する</label>
    <label className="lxs-search-checkbox"><input type="checkbox" checked={!!query.useRegex} disabled={locked} onChange={event => setQuery({ ...query, useRegex: event.target.checked })} />正規表現を使用する</label>
  </>;
  const context = { ...search, mode: replacing ? "replace" as const : "find" as const, defaultInput, defaultOptions, defaultReplacement, disabled: locked };
  const fields = c.renderSearch?.(context) ?? <>{defaultInput}{defaultReplacement}{defaultOptions}</>;
  return <SpreadsheetDialog title={replacing ? "検索と置換" : "検索"} initialFocusRef={first} onClose={() => { if (busy) c.cancelEditRequest(); onClose(); }} className="lxs-search-dialog"
    actions={<>{c.search?.trigger === "submit" && <button type="button" disabled={locked || !query.text} onClick={search.submit}>検索する</button>}
      <button type="button" disabled={locked || searching || !!error || !matches.length} onClick={() => navigate(-1)}>前を検索</button><button type="button" disabled={locked || searching || !!error || !matches.length} onClick={() => navigate(1)}>次を検索</button>
      {replacing && <><button type="button" disabled={locked || searching || search.pending || !!error || c.disabled || !matches.length} onClick={() => replace(false)}>置換</button><button type="button" disabled={locked || searching || search.pending || !!error || c.disabled || !matches.length} onClick={() => replace(true)}>すべて置換</button></>}</>}>
    <div className="lxs-search-fields" onKeyDown={event => {
      const target = event.target as HTMLElement, input = target.tagName === "TEXTAREA" || target.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((target as HTMLInputElement).type);
      if (input && event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (c.search?.trigger === "submit") search.submit(); else navigate(event.shiftKey ? -1 : 1); }
    }}>
      {fields}
    </div>
    {replacing && query.lookIn === "values" && <p className="lxs-search-note">表示値を置換すると、数式のセルも表示結果の文字列・値に置き換わります。</p>}
    {error && <p role="alert">{error}</p>}
    <p role="status">{searching ? "検索中…" : message || (query.text ? `${matches.length}個のセルが一致${selectedIndex >= 0 ? `（${selectedIndex + 1}/${matches.length}）` : ""}` : "検索する文字列を入力してください")}</p>
    {matches.length > 0 && <div className="lxs-search-results" role="list" aria-label="検索結果">{matches.slice(0, 200).map(match =>
      <button key={`${match.sheetId}:${match.address}`} type="button" role="listitem" disabled={locked || searching} aria-current={match === matches[selectedIndex] ? "true" : undefined} onClick={() => choose(match)}>
        <span>{c.workbook.sheets.find(sheet => sheet.id === match.sheetId)?.name}!{match.address}</span><span>{match.matchedText.slice(0, 150)}</span>
      </button>)}{matches.length > 200 && <p>先頭200件を表示しています。次を検索で全件を移動できます。</p>}</div>}
  </SpreadsheetDialog>;
}
