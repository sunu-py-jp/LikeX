"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cellAddress } from "../../model/address";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { SpreadsheetFilterIcon } from "../spreadsheet-filter-toolbar";

type FilterTarget = {
  sheetId: string;
  revision: number;
  filter: NonNullable<SpreadsheetController["filters"]["autoFilter"]>;
  column: number;
  label: string;
  values: readonly string[];
  button: HTMLButtonElement;
};
const VALUE_BATCH = 100;
const valueKey = (value: string) => value.toLowerCase();

/** The checklist is deliberately mounted only after a column menu is opened. */
export function SpreadsheetFilterChoices({ values, initialValues, disabled, onApply, onClear, onClose }: {
  values: readonly string[];
  initialValues?: readonly string[];
  disabled: boolean;
  onApply: (values: readonly string[] | null) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set((initialValues ?? values).map(valueKey)));
  const [limit, setLimit] = useState(VALUE_BATCH);
  const list = useRef<HTMLDivElement>(null), all = useRef<HTMLInputElement>(null);
  const matching = useMemo(() => {
    const needle = query.toLowerCase();
    return values.filter(value => (value || "空白").toLowerCase().includes(needle));
  }, [query, values]);
  const matchingSelected = matching.reduce((count, value) => count + Number(selected.has(valueKey(value))), 0);
  const selectedCount = values.reduce((count, value) => count + Number(selected.has(valueKey(value))), 0);
  const allSelected = matching.length > 0 && matchingSelected === matching.length;
  useLayoutEffect(() => { if (all.current) all.current.indeterminate = matchingSelected > 0 && !allSelected; }, [matchingSelected, allSelected]);
  const selectMatching = (checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    for (const value of matching) { if (checked) next.add(valueKey(value)); else next.delete(valueKey(value)); }
    return next;
  });
  const remaining = matching.length > limit;
  return <>
    <input className="lxs-filter-search" type="search" aria-label="フィルターの値を検索" placeholder="検索" value={query} disabled={disabled}
      onChange={event => { setQuery(event.currentTarget.value); setLimit(VALUE_BATCH); if (list.current) list.current.scrollTop = 0; }} />
    <label className="lxs-filter-choice lxs-filter-select-all"><input ref={all} type="checkbox" checked={allSelected} disabled={disabled || !matching.length}
      onChange={event => selectMatching(event.currentTarget.checked)} /><span>{query ? "検索結果をすべて選択" : "すべて選択"}</span></label>
    <div ref={list} className="lxs-filter-values" role="group" aria-label="表示する値" tabIndex={0}
      onScroll={event => {
        const element = event.currentTarget;
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 60 && remaining) setLimit(previous => previous + VALUE_BATCH);
      }}>
      {matching.slice(0, limit).map(value => <label key={value} className="lxs-filter-choice" title={value || "空白"}>
        <input type="checkbox" checked={selected.has(valueKey(value))} disabled={disabled} onChange={event => {
          const checked = event.currentTarget.checked;
          setSelected(previous => { const next = new Set(previous); if (checked) next.add(valueKey(value)); else next.delete(valueKey(value)); return next; });
        }} /><span>{value || "（空白）"}</span>
      </label>)}
      {!matching.length && <p className="lxs-filter-empty">一致する値がありません</p>}
      {remaining && <button type="button" className="lxs-filter-more" disabled={disabled} onClick={() => setLimit(previous => previous + VALUE_BATCH)}>さらに {Math.min(VALUE_BATCH, matching.length - limit)} 件を表示</button>}
    </div>
    <div className="lxs-filter-summary" aria-live="polite">{selectedCount.toLocaleString()} / {values.length.toLocaleString()} 件を選択</div>
    <div className="lxs-filter-actions">
      <button type="button" disabled={disabled || !initialValues} onClick={onClear}>条件をクリア</button>
      <button type="button" onClick={onClose}>キャンセル</button>
      <button type="button" className="lxs-filter-apply" disabled={disabled} onClick={() => onApply(values.length > 0 && values.length === selectedCount ? null : values.filter(value => selected.has(valueKey(value))))}>適用</button>
    </div>
  </>;
}

function SpreadsheetFilterPopover({ controller: c, target, id, onClose }: {
  controller: SpreadsheetController;
  target: FilterTarget;
  id: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null), latestClose = useRef(onClose);
  const region = target.button.closest<HTMLElement>("[data-likex-spreadsheet]");
  const stale = c.activeSheet.id !== target.sheetId || c.filters.autoFilter !== target.filter || c.getRevision() !== target.revision;
  useLayoutEffect(() => { latestClose.current = onClose; });
  useEffect(() => { if (stale || !c.features.filters) onClose(); }, [stale, c.features.filters, onClose]);
  useLayoutEffect(() => {
    const menu = panel.current;
    if (!menu || !region) return;
    const doc = region.ownerDocument, view = doc.defaultView;
    const bounds = region.getBoundingClientRect(), button = target.button.getBoundingClientRect();
    // The grid has its own CSS zoom; the portal is positioned in the unzoomed root.
    const scaleX = region.offsetWidth ? bounds.width / region.offsetWidth : 1;
    const scaleY = region.offsetHeight ? bounds.height / region.offsetHeight : 1;
    const originX = bounds.left + region.clientLeft * scaleX, originY = bounds.top + region.clientTop * scaleY;
    const left = (Math.max(originX, 0) - originX) / scaleX + 4;
    const top = (Math.max(originY, 0) - originY) / scaleY + 4;
    const right = (Math.min(bounds.right, view?.innerWidth ?? bounds.right) - originX) / scaleX - 4;
    const bottom = (Math.min(bounds.bottom, view?.innerHeight ?? bounds.bottom) - originY) / scaleY - 4;
    menu.style.width = `${Math.max(0, Math.min(300, right - left))}px`;
    menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const y = (button.bottom - originY) / scaleY + 2;
    const proposedTop = y + menu.offsetHeight <= bottom ? y : (button.top - originY) / scaleY - menu.offsetHeight - 2;
    menu.style.left = `${Math.max(left, Math.min((button.right - originX) / scaleX - menu.offsetWidth, right - menu.offsetWidth)) + region.scrollLeft}px`;
    menu.style.top = `${Math.max(top, Math.min(proposedTop, bottom - menu.offsetHeight)) + region.scrollTop}px`;
    (menu.querySelector<HTMLInputElement>('input[type="search"]') ?? menu).focus({ preventScroll: true });
    const close = () => latestClose.current();
    const outside = (event: Event) => { if (!menu.contains(event.target as Node) && event.target !== target.button) close(); };
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("focusin", outside);
    doc.addEventListener("scroll", scroll, true);
    view?.addEventListener("resize", close);
    return () => {
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("focusin", outside);
      doc.removeEventListener("scroll", scroll, true);
      view?.removeEventListener("resize", close);
      if (target.button.isConnected && (!doc.activeElement || doc.activeElement === doc.body || menu.contains(doc.activeElement))) target.button.focus({ preventScroll: true });
    };
  }, [region, target]);
  const apply = (values: readonly string[] | null) => {
    // Public APIs can switch sheets or replace a temporary filter before React commits the next render.
    if (c.filters.disabled || stale || c.getRevision() !== target.revision ||
      c.selectionApi.getSelection().sheetId !== target.sheetId || c.filterViewApi.getFilterView(target.sheetId) !== target.filter) return;
    c.filters.setValues(target.column, values); onClose();
  };
  if (!region) return null;
  return createPortal(<div ref={panel} id={id} className="lxs-filter-popover" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} tabIndex={-1}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
    onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
    }}>
    <div className="lxs-filter-heading"><h2 id={`${id}-title`}>{target.label}</h2><button type="button" aria-label="フィルターを閉じる" onClick={onClose}>×</button></div>
    <SpreadsheetFilterChoices values={target.values} initialValues={target.filter.columns?.find(item => item.column === target.column)?.values}
      disabled={c.filters.disabled || stale} onApply={apply} onClear={() => apply(null)} onClose={onClose} />
  </div>, region);
}

export function SpreadsheetFilterButtons({ controller: c, columnOffsets, rowOffsets }: {
  controller: SpreadsheetController;
  columnOffsets: readonly number[];
  rowOffsets: readonly number[];
}) {
  const [target, setTarget] = useState<FilterTarget | null>(null);
  const id = useId(), filter = c.filters?.autoFilter;
  if (!c.features.filters || !filter) return null;
  const top = rowOffsets[filter.range.top], height = rowOffsets[filter.range.top + 1] - top;
  const open = (column: number, label: string, button: HTMLButtonElement) => {
    if (c.filters.disabled) return;
    if (target?.button === button) { setTarget(null); return; }
    try {
      const seen = new Set<string>();
      const values = [...c.filters.getValues(column), ...(filter.columns?.find(item => item.column === column)?.values ?? [])].filter(value => {
        const key = valueKey(value);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      setTarget({ sheetId: c.activeSheet.id, revision: c.getRevision(), filter, column, label, values, button });
    } catch (cause) { c.reportError(cause); }
  };
  return <>
    <div className="lxs-filter-buttons">
      {height > 0 && Array.from({ length: filter.range.right - filter.range.left + 1 }, (_, index) => {
        const column = filter.range.left + index, width = columnOffsets[column + 1] - columnOffsets[column];
        if (width <= 0) return null;
        const address = cellAddress(filter.range.top, column), value = c.calculated[c.activeSheet.id]?.[address] ?? c.activeSheet.cells[address]?.value;
        const label = `${value === undefined || value === "" ? address.replace(/\d+$/, "") + "列" : value}のフィルター`;
        const filtered = !!filter.columns?.some(item => item.column === column);
        return <button key={column} type="button" className="lxs-filter-button" data-filtered={filtered || undefined}
          style={{ left: columnOffsets[column + 1] - Math.min(width, 20), top: top + Math.max(0, height - 20), width: Math.min(width, 20), height: Math.min(height, 20) }}
          aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={target?.column === column} aria-controls={target?.column === column ? id : undefined} disabled={c.filters.disabled}
          onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); open(column, label, event.currentTarget); }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) { event.preventDefault(); if (!target || target.column !== column) open(column, label, event.currentTarget); }
          }}>{filtered ? <SpreadsheetFilterIcon /> : <span aria-hidden="true">▾</span>}</button>;
      })}
    </div>
    {target && <SpreadsheetFilterPopover controller={c} target={target} id={id} onClose={() => setTarget(null)} />}
  </>;
}
