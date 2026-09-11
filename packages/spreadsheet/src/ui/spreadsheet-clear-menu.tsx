"use client";

import { rangeBounds, selectionRanges } from "../state/selection";
import type { SpreadsheetCommand } from "../api/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";

export function SpreadsheetClearMenu({ controller: c }: { controller: SpreadsheetController }) {
  if (c.readOnly) return null;
  const disabled = c.disabled || c.requesting || c.pendingObjectEdit || !!c.selectedDrawingId;
  return <div className="lxs-tool-group"><select aria-label="セルをクリア" className="lxs-select" disabled={disabled} value="" onChange={event => {
    if (disabled) return;
    const mode = event.target.value;
    if (mode !== "values" && mode !== "all") return;
    const commands: readonly SpreadsheetCommand[] = selectionRanges(c.selection).map(range => ({ type: "cells.clear",
      sheetId: c.activeSheet.id, range: rangeBounds(range), mode }));
    const structureRevision = c.getStructureRevision();
    c.afterCommit(() => {
      if (c.getStructureRevision() !== structureRevision) { c.reportError(new Error("選択範囲が変わりました。範囲を選び直してください。")); return; }
      const revision = c.getRevision();
      void c.executeCommands(commands, { isCurrent: () => c.getRevision() === revision });
    });
  }}>
    <option value="" disabled>クリア</option>
    <option value="values">値のみクリア</option>
    <option value="all">すべてクリア（書式・コメントなども削除）</option>
  </select></div>;
}
