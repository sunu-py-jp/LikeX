"use client";

import { useId, useState } from "react";
import type { SpreadsheetCommand } from "../api/types";
import type { SpreadsheetSelection } from "../props";
import { cellAddress } from "../model/address";
import { expandRangeForMerges } from "../model/merges";
import { clampPosition, isMultiRangeSelection, selectionBounds } from "../state/selection";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { useSpreadsheetDialogCommand } from "./use-spreadsheet-dialog-command";

type ShiftChoice = "vertical" | "horizontal" | "rows" | "columns";
type ShiftTarget = { sheetId: string; selection: SpreadsheetSelection; revision: number };

/** The form chooses an operation; all data movement and validation use the public command pipeline. */
export function SpreadsheetCellShiftDialog({ controller: c, target, operation, onClose }: {
  controller: SpreadsheetController;
  target: ShiftTarget;
  operation: "insert" | "delete";
  onClose: () => void;
}) {
  const insert = operation === "insert", id = useId();
  const options: { value: ShiftChoice; label: string }[] = [];
  if (insert ? c.features.insertCells : c.features.deleteCells) options.push(
    {value: "vertical", label: insert ? "下方向にシフト" : "上方向にシフト"},
    {value: "horizontal", label: insert ? "右方向にシフト" : "左方向にシフト"});
  if (insert ? c.features.insertRows : c.features.deleteRows) options.push({value: "rows", label: "行全体"});
  if (insert ? c.features.insertColumns : c.features.deleteColumns) options.push({value: "columns", label: "列全体"});
  const [choice, setChoice] = useState<ShiftChoice>(() => options[0]?.value ?? "vertical");
  const action = useSpreadsheetDialogCommand(c, target.revision, target.selection);
  const bounds = selectionBounds(target.selection);
  const first = cellAddress(bounds.top, bounds.left), last = cellAddress(bounds.bottom, bounds.right);
  const valid = !isMultiRangeSelection(target.selection) && options.some(option => option.value === choice);
  const apply = () => {
    if (!valid) return;
    let command: SpreadsheetCommand;
    if (choice === "rows" || choice === "columns") command = {
      type: choice === "rows" ? (insert ? "rows.insert" : "rows.delete") : (insert ? "columns.insert" : "columns.delete"),
      sheetId: target.sheetId,
      index: choice === "rows" ? bounds.top : bounds.left,
      count: choice === "rows" ? bounds.bottom - bounds.top + 1 : bounds.right - bounds.left + 1,
    };
    else command = insert ? {type: "cells.insert", sheetId: target.sheetId, range: bounds, shift: choice === "vertical" ? "down" : "right"}
      : {type: "cells.delete", sheetId: target.sheetId, range: bounds, shift: choice === "vertical" ? "up" : "left"};
    void action.run(command, () => {
      const sheet = c.getWorkbook().sheets.find(item => item.id === target.sheetId);
      if (sheet) {
        const anchor = clampPosition({row: bounds.top, column: bounds.left}, sheet);
        const focus = clampPosition({row: bounds.bottom, column: bounds.right}, sheet);
        if (choice === "rows") { anchor.column = 0; focus.column = sheet.columnCount - 1; }
        if (choice === "columns") { anchor.row = 0; focus.row = sheet.rowCount - 1; }
        if (choice === "vertical" || choice === "horizontal") {
          const selected = expandRangeForMerges(sheet, {top: anchor.row, left: anchor.column, bottom: focus.row, right: focus.column});
          anchor.row = selected.top; anchor.column = selected.left;
          focus.row = selected.bottom; focus.column = selected.right;
        }
        c.selectRangeInSheet(sheet.id, anchor, focus, anchor, choice === "rows" ? "row" : choice === "columns" ? "column" : undefined);
      }
      onClose();
      c.requestGridFocus();
    });
  };
  return <SpreadsheetDialog title={insert ? "セルの挿入" : "セルの削除"} onClose={onClose} actions={<>
    <button type="button" onClick={onClose}>キャンセル</button>
    <button type="button" disabled={action.disabled || !valid} onClick={apply}>{insert ? "挿入" : "削除"}</button>
  </>}>
    <p>対象: {first === last ? first : `${first}:${last}`}</p>
    <div role="radiogroup" aria-label={insert ? "挿入方法" : "削除方法"} onKeyDown={event => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!action.disabled) apply();
      }
    }}>
      {options.map(option => <label key={option.value}>
        <input type="radio" name={id} value={option.value} checked={choice === option.value} disabled={action.disabled}
          onChange={() => setChoice(option.value)} />{option.label}
      </label>)}
    </div>
    {isMultiRangeSelection(target.selection) && <p role="alert">一続きのセル範囲を選択してください</p>}
    {action.error && <p role="alert">{action.error}</p>}
  </SpreadsheetDialog>;
}
