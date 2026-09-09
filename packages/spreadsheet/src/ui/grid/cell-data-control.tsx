"use client";

import type { SpreadsheetCell, SpreadsheetCellPosition } from "../../model/types";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

/** Small native controls share the ordinary cell command/permission/history boundary. */
export function CellDataControl({ controller: c, cell, address, position, focused, editing }: {
  controller: SpreadsheetController; cell?: SpreadsheetCell; address: string; position: SpreadsheetCellPosition; focused: boolean; editing: boolean;
}) {
  const rule = cell?.validation;
  if (!rule || !c.features.dataValidation || editing || (rule.type !== "list" && rule.type !== "checkbox") ||
    (rule.type === "checkbox" && !c.features.checkboxes)) return null;
  const disabled = c.disabled || c.requesting || !!c.selectedDrawingId;
  const setValue = (value: string) => {
    if (disabled) return;
    const sheetId = c.activeSheet.id;
    c.afterCommit(() => {
      c.select(position);
      c.afterCommand({ type: "cells.set", sheetId, values: { [address]: value } }, () => c.requestGridFocus());
    });
  };
  if (rule.type === "checkbox") {
    const value = c.calculated[c.activeSheet.id]?.[address];
    return <span className="lxs-cell-checkbox" data-lxs-cell-control onDoubleClick={event => event.stopPropagation()}>
      <input type="checkbox" aria-label={`${address}のチェックボックス`} checked={value === true || String(value).toLowerCase() === "true"}
        disabled={disabled} tabIndex={focused ? 0 : -1}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === " ") event.stopPropagation(); }}
        onChange={event => setValue(event.currentTarget.checked ? "TRUE" : "FALSE")} />
    </span>;
  }
  if (!focused) return null;
  const computed = c.calculated[c.activeSheet.id]?.[address], value = typeof computed === "boolean" ? (computed ? "TRUE" : "FALSE") : String(computed ?? "");
  const selected = rule.values.find(item => item.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US")) ?? "";
  return <select className="lxs-cell-list" data-lxs-cell-control aria-label={`${address}の選択肢`} title="リストから選択" value={selected}
    disabled={disabled} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onChange={event => { const selected = event.currentTarget.value; setValue(/^[=']/.test(selected) ? `'${selected}` : selected); }}>
    <option value="" disabled={rule.allowBlank === false}>{rule.allowBlank === false ? "選択してください" : "空白"}</option>
    {rule.values.map(item => <option key={item} value={item}>{item}</option>)}
  </select>;
}
