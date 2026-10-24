"use client";

import type { SpreadsheetController } from "../state/use-spreadsheet";
import { isMultiRangeSelection } from "../state/selection";
import { Command, Icon } from "./spreadsheet-controls";
import { RibbonGroup } from "./spreadsheet-ribbon-group";

export function SpreadsheetFilterIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" /></svg>;
}

export function SpreadsheetFilterToolbar({ controller: c }: { controller: SpreadsheetController }) {
  if (!c.features.filters || !c.filters) return null;
  const active = !!c.filters.autoFilter;
  const multiple = isMultiRangeSelection(c.selection);
  const disabled = c.filters.disabled || !!c.selectedDrawingId || (!active && multiple);
  return <RibbonGroup label="フィルター"><div className="lxs-ribbon-columns">
    <Command label="フィルター" className="lxs-ribbon-command-large" aria-pressed={active} disabled={disabled}
      title={!active && multiple ? "1つの連続した範囲を選択してください" : active ? "フィルターを解除" : "選択範囲にフィルターを設定"}
      onClick={c.filters.toggle}><SpreadsheetFilterIcon /><span>フィルター</span></Command>
    <Command label="フィルター条件をクリア" className="lxs-ribbon-command-large" disabled={c.filters.disabled || !c.filters.autoFilter?.columns?.length}
      onClick={c.filters.clear}><Icon name="close" /><span>クリア</span></Command>
  </div></RibbonGroup>;
}
