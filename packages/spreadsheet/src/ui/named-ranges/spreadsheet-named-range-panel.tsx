"use client";

import { namedRangeAddress } from "../../model/named-ranges";
import { isMultiRangeSelection, selectionBounds } from "../../state/selection";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { Command, Icon } from "../spreadsheet-controls";
import type { NamedRangeManager } from "./use-named-range-manager";

export function SpreadsheetNamedRangePanel({ controller: c, manager }: { controller: SpreadsheetController; manager: NamedRangeManager }) {
  if (!c.features.namedRanges || !manager.open) return null;
  const definitions = c.workbook.namedRanges ?? [], bounds = selectionBounds(c.selection);
  const blocked = c.saving || c.refreshing || c.requesting || c.contextMenuLocked || c.pendingObjectEdit;
  return <aside className="lxs-named-range-panel" aria-label="名前付き範囲の管理" onKeyDown={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); manager.close(); }
  }}>
    <div className="lxs-named-range-heading"><strong>名前付き範囲</strong>
      <Command label="名前付き範囲の管理を閉じる" onClick={manager.close}><Icon name="close" /></Command>
    </div>
    {definitions.length ? <ul className="lxs-named-range-list">{definitions.map(definition => {
      const sheetName = c.workbook.sheets.find(sheet => sheet.id === definition.sheetId)?.name ?? definition.sheetId;
      const address = namedRangeAddress(definition.range), location = `${sheetName}!${address}`;
      const otherSheetDisabled = !c.features.sheets && definition.sheetId !== c.activeSheet.id;
      const unavailableHint = "シートの切り替えが無効なため、別シートの範囲は選択・編集できません。";
      const selected = !isMultiRangeSelection(c.selection) && definition.sheetId === c.activeSheet.id &&
        bounds.top === definition.range.top && bounds.left === definition.range.left && bounds.bottom === definition.range.bottom && bounds.right === definition.range.right;
      return <li key={definition.id} className="lxs-named-range-card" data-selected={selected || undefined}>
        <button type="button" className="lxs-named-range-jump" aria-label={`${definition.name}へ移動`} aria-current={selected ? "true" : undefined}
          title={otherSheetDisabled ? unavailableHint : `${definition.name}\n${location}`} disabled={blocked || otherSheetDisabled} onClick={() => manager.select(definition.id)}>
          <strong>{definition.name}</strong><span>{location}</span>
        </button>
        {!c.readOnly && <Command label={`${definition.name}を編集`} className="lxs-named-range-edit" disabled={blocked || c.disabled || otherSheetDisabled}
          title={otherSheetDisabled ? unavailableHint : undefined} onClick={() => manager.edit(definition.id)}><Icon name="edit" /></Command>}
      </li>;
    })}</ul> : <div className="lxs-named-range-empty"><p>名前付き範囲はありません。</p>
      {!c.readOnly && <p>リボンの「追加」から範囲に名前を付けられます。</p>}
    </div>}
  </aside>;
}
