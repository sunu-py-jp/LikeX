"use client";

import { useMemo, useRef, useState } from "react";
import { chainResult } from "../core";
import type { SpreadsheetSearchMatch, SpreadsheetSearchQuery } from "../api/editing-commands";
import type { SpreadsheetCommand } from "../api/types";
import { parseCellAddress } from "../model/address";
import { findSpreadsheetCells } from "../model/editing/search";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { SpreadsheetDialog } from "./spreadsheet-dialog";

export function SpreadsheetSearchDialog({ controller: c, initialMode, onClose }: {
  controller: SpreadsheetController; initialMode: "find" | "replace"; onClose: () => void;
}) {
  const first = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [replacement, setReplacement] = useState("");
  const [scope, setScope] = useState<"sheet" | "workbook">("sheet");
  const [lookIn, setLookIn] = useState<"values" | "formulas">(initialMode === "replace" ? "formulas" : "values");
  const [matchCase, setMatchCase] = useState(false), [wholeCell, setWholeCell] = useState(false);
  const [selected, setSelected] = useState<SpreadsheetSearchMatch | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const query: SpreadsheetSearchQuery = useMemo(() => ({ text, matchCase, wholeCell, lookIn }), [text, matchCase, wholeCell, lookIn]);
  const sheetId = scope === "sheet" || !c.features.sheets ? c.activeSheet.id : undefined;
  const matches = useMemo(() => findSpreadsheetCells(c.workbook, query, { sheetId, calculated: c.calculated }), [c.workbook, c.calculated, query, sheetId]);
  const selectedIndex = matches.findIndex(match => match.address === selected?.address && match.sheetId === selected.sheetId);
  const replacing = initialMode === "replace" && c.features.replace && !c.readOnly;
  const locked = busy || c.requesting || c.saving || c.refreshing;
  const choose = (match: SpreadsheetSearchMatch) => {
    setSelected(match); setMessage("");
    c.selectCellInSheet(match.sheetId, parseCellAddress(match.address)!);
  };
  const navigate = (direction: 1 | -1) => {
    if (!matches.length) { setMessage("一致するセルがありません"); return; }
    const index = selectedIndex < 0 ? direction === 1 ? 0 : matches.length - 1 : (selectedIndex + direction + matches.length) % matches.length;
    choose(matches[index]);
  };
  const replace = (all: boolean) => {
    if (!replacing || c.disabled || locked || !text) return;
    const targets = all ? matches : selectedIndex >= 0 ? [matches[selectedIndex]] : matches.slice(0, 1);
    if (!targets.length) { setMessage("置換するセルがありません"); return; }
    const groups = new Map<string, string[]>();
    for (const match of targets) { const addresses = groups.get(match.sheetId) ?? []; addresses.push(match.address); groups.set(match.sheetId, addresses); }
    const commands: SpreadsheetCommand[] = [...groups].map(([sheetId, addresses]) => ({ type: "cells.replace", sheetId, query, replacement, addresses }));
    setBusy(true);
    void chainResult(c.executeCommands(commands), result => {
      setBusy(false);
      if (result.ok) { setMessage(`${targets.length}個のセルを置換しました`); setSelected(null); }
      else setMessage(result.message);
    });
  };
  return <SpreadsheetDialog title={replacing ? "検索と置換" : "検索"} initialFocusRef={first} onClose={() => { if (busy) c.cancelEditRequest(); onClose(); }} className="lxs-search-dialog"
    actions={<><button type="button" disabled={locked || !text} onClick={() => navigate(-1)}>前を検索</button><button type="button" disabled={locked || !text} onClick={() => navigate(1)}>次を検索</button>
      {replacing && <><button type="button" disabled={locked || c.disabled || !matches.length} onClick={() => replace(false)}>置換</button><button type="button" disabled={locked || c.disabled || !matches.length} onClick={() => replace(true)}>すべて置換</button></>}</>}>
    <div className="lxs-search-fields" onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }}>
      <label>検索する文字列<input ref={first} value={text} maxLength={100_000} disabled={locked} onChange={event => { setText(event.target.value); setSelected(null); setMessage(""); }} /></label>
      {replacing && <label>置換後の文字列<input value={replacement} maxLength={100_000} disabled={locked} onChange={event => setReplacement(event.target.value)} /></label>}
      <div className="lxs-search-options"><label>検索範囲<select value={c.features.sheets ? scope : "sheet"} disabled={locked} onChange={event => { setScope(event.target.value as "sheet" | "workbook"); setSelected(null); }}><option value="sheet">現在のシート</option>{c.features.sheets && <option value="workbook">ブック全体</option>}</select></label>
        <label>検索対象<select value={lookIn} disabled={locked} onChange={event => { setLookIn(event.target.value as "values" | "formulas"); setSelected(null); }}><option value="values">表示値</option><option value="formulas">数式・入力値</option></select></label></div>
      <label className="lxs-search-checkbox"><input type="checkbox" checked={matchCase} disabled={locked} onChange={event => setMatchCase(event.target.checked)} />大文字と小文字を区別する</label>
      <label className="lxs-search-checkbox"><input type="checkbox" checked={wholeCell} disabled={locked} onChange={event => setWholeCell(event.target.checked)} />セルの内容全体と一致する</label>
    </div>
    {replacing && lookIn === "values" && <p className="lxs-search-note">表示値を置換すると、数式のセルも表示結果の文字列・値に置き換わります。</p>}
    <p role="status">{message || (text ? `${matches.length}個のセルが一致${selectedIndex >= 0 ? `（${selectedIndex + 1}/${matches.length}）` : ""}` : "検索する文字列を入力してください")}</p>
    {matches.length > 0 && <div className="lxs-search-results" role="list" aria-label="検索結果">{matches.slice(0, 200).map(match =>
      <button key={`${match.sheetId}:${match.address}`} type="button" role="listitem" disabled={locked} aria-current={match === matches[selectedIndex] ? "true" : undefined} onClick={() => choose(match)}>
        <span>{c.workbook.sheets.find(sheet => sheet.id === match.sheetId)?.name}!{match.address}</span><span>{match.matchedText.slice(0, 150)}</span>
      </button>)}{matches.length > 200 && <p>先頭200件を表示しています。次を検索で全件を移動できます。</p>}</div>}
  </SpreadsheetDialog>;
}
