"use client";

import { useState } from "react";
import type { SpreadsheetTableWriteOptions } from "../api/table-commands";
import { cellAddress } from "../model/address";
import { calculateWorkbook } from "../model/formula";
import { effectiveCellFormat, formatCellValue } from "../model/formatting/display";
import { getRange } from "../model/query";
import { namedRangeAddress } from "../model/named-ranges";
import { isMultiRangeSelection, selectionBounds } from "../state/selection";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { Command, Icon } from "./spreadsheet-controls";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { useSpreadsheetDialogCommand } from "./use-spreadsheet-dialog-command";

type TableTarget = { options: SpreadsheetTableWriteOptions; address: string; revision: number; name: string };

function captureTable(controller: SpreadsheetController): TableTarget {
  const workbook = controller.getWorkbook(), sheetId = controller.activeSheet.id;
  const range = selectionBounds(controller.selection), rows = getRange(workbook, sheetId, range);
  const calculated = calculateWorkbook(workbook)[sheetId];
  const headers = rows[0].map((cell, column) => formatCellValue(calculated[cellAddress(range.top, range.left + column)],
    effectiveCellFormat(cell ?? undefined)) || `列${column + 1}`);
  const names = new Set([...(workbook.namedRanges ?? []).map(item => item.name.toLocaleLowerCase("en-US")),
    ...workbook.sheets.flatMap(sheet => sheet.tables?.map(table => table.name.toLocaleLowerCase("en-US")) ?? [])]);
  let count = 1;
  while (names.has(`table${count}`)) count++;
  return { address: namedRangeAddress(range), revision: controller.getRevision(), name: `Table${count}`,
    options: { sheetId, target: { row: range.top, column: range.left }, headers,
      data: { type: "rows", values: rows.slice(1).map(row => row.map(cell => cell?.value ?? "")) } } };
}

function TableDialog({ controller: c, target, onClose }: { controller: SpreadsheetController; target: TableTarget; onClose: () => void }) {
  const [name, setName] = useState(target.name);
  const action = useSpreadsheetDialogCommand(c, target.revision);
  return <SpreadsheetDialog title="テーブルを作成" onClose={onClose} actions={<>
    <button type="button" onClick={onClose}>キャンセル</button>
    <button type="button" disabled={action.disabled || !name.trim()} onClick={() => void action.run({
      type: "tables.insert", ...target.options, name: name.trim(),
    }, onClose)}>作成</button>
  </>}>
    <label>テーブル名<input maxLength={255} disabled={action.disabled} value={name} onChange={event => setName(event.target.value)} /></label>
    <p>対象は {target.address} です。先頭行を列の見出しとして使い、空の見出しには「列1」などの名前を付けます。</p>
    <p>セルの値と罫線に加え、テーブル名・列名・範囲を保存します。</p>
    {action.error && <p role="alert">{action.error}</p>}
  </SpreadsheetDialog>;
}

export function SpreadsheetTableTools({ controller: c }: { controller: SpreadsheetController }) {
  const [target, setTarget] = useState<TableTarget | null>(null);
  const multiple = isMultiRangeSelection(c.selection);
  const disabled = c.disabled || c.requesting || c.pendingObjectEdit || !!c.selectedDrawingId || multiple;
  if (c.readOnly || !c.features.tables || !c.features.formatting) return null;
  const open = (structured: boolean) => {
    if (disabled) return;
    const structureRevision = c.getStructureRevision();
    c.afterCommit(() => {
      if (c.getStructureRevision() !== structureRevision) { c.reportError(new Error("選択範囲が変わりました。範囲を選び直してください。")); return; }
      try {
        const captured = captureTable(c);
        if (structured) setTarget(captured);
        else void c.executeCommands([{ type: "cells.writeTable", ...captured.options }], {
          isCurrent: () => c.getRevision() === captured.revision,
        });
      } catch (cause) { c.reportError(cause); }
    });
  };
  const hint = multiple ? "1つの連続した範囲を選択してください" : undefined;
  return <><RibbonGroup label="テーブル"><div className="lxs-ribbon-columns">
    <Command label="テーブルを挿入" className="lxs-ribbon-command-large" disabled={disabled} title={hint} onClick={() => open(true)}><Icon name="table" /><span>テーブル</span></Command>
    <Command label="罫線付きの表を作成" className="lxs-ribbon-command-large" disabled={disabled} title={hint ?? "選択したセルに罫線を付け、先頭行を見出しにします"} onClick={() => open(false)}><Icon name="borders" /><span>罫線付きの表</span></Command>
    </div></RibbonGroup>
    {target && <TableDialog controller={c} target={target} onClose={() => { c.cancelEditRequest(); setTarget(null); }} />}
  </>;
}
