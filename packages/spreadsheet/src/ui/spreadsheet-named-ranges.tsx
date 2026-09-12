"use client";

import { isMultiRangeSelection } from "../state/selection";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { Command, Icon } from "./spreadsheet-controls";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import type { NamedRangeManager } from "./named-ranges/use-named-range-manager";
export { SpreadsheetNamedRangePanel } from "./named-ranges/spreadsheet-named-range-panel";
export { NamedRangeDialog } from "./named-ranges/named-range-dialog";

export function SpreadsheetNamedRanges({ controller: c, manager }: { controller: SpreadsheetController; manager: NamedRangeManager }) {
  if (!c.features.namedRanges) return null;
  const multiple = isMultiRangeSelection(c.selection);
  const blocked = c.saving || c.refreshing || c.requesting || c.contextMenuLocked || c.pendingObjectEdit;
  return <RibbonGroup label="名前付き範囲">
    <div className="lxs-ribbon-columns">
      {!c.readOnly && <Command label="名前付き範囲を追加" className="lxs-ribbon-command-large" disabled={blocked || c.disabled || !!c.selectedDrawingId || multiple}
        title={multiple ? "1つの連続した範囲を選択してください" : undefined} onClick={manager.openAdd}><Icon name="namedRange" /><span>追加</span></Command>}
      <Command label="名前付き範囲を管理" className="lxs-ribbon-command-large" disabled={blocked} aria-pressed={manager.open}
        onClick={manager.toggle}><Icon name="namedRange" /><span>管理</span></Command>
    </div>
  </RibbonGroup>;
}
