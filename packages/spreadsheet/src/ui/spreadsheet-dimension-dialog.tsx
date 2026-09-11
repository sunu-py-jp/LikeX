"use client";

import { useState } from "react";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { selectionAxisIndices } from "../state/context-menu/builtin-items";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { useSpreadsheetDialogCommand } from "./use-spreadsheet-dialog-command";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../model/sheet-dimensions";

export function SpreadsheetDimensionDialog({controller: c, target, onClose}: {
  controller: SpreadsheetController;
  target: {axis: "row" | "column"; sheetId: string; selection: SpreadsheetSelection; revision: number};
  onClose: () => void;
}) {
  const row = target.axis === "row", title = row ? "行の高さ" : "列の幅";
  const [indices] = useState(() => selectionAxisIndices(target.selection, target.axis));
  const [value, setValue] = useState(() => {
    const sheet = c.getWorkbook().sheets.find(item => item.id === target.sheetId)!;
    return String(row ? sheet.rowHeights?.[indices[0]] ?? DEFAULT_ROW_HEIGHT : sheet.columnWidths?.[indices[0]] ?? DEFAULT_COLUMN_WIDTH);
  });
  const action = useSpreadsheetDialogCommand(c, target.revision);
  const size = Number(value), valid = value.trim() !== "" && Number.isFinite(size) && size >= (row ? 16 : 24) && size <= 1000;
  return <SpreadsheetDialog title={title} onClose={onClose} actions={<>
    <button type="button" onClick={onClose}>キャンセル</button>
    <button type="button" disabled={action.disabled || !valid} onClick={() => {
      if (!valid) return;
      const dimensions = Object.fromEntries(indices.map(index => [index, size]));
      void action.run({type: "dimensions.resize", sheetId: target.sheetId, ...(row ? {rowHeights: dimensions} : {columnWidths: dimensions})}, onClose);
    }}>適用</button>
  </>}>
    <label>{title}（px）<input type="number" min={row ? 16 : 24} max={1000} value={value} disabled={action.disabled}
      onChange={event => setValue(event.target.value)} /></label>
    {action.error && <p role="alert">{action.error}</p>}
  </SpreadsheetDialog>;
}
