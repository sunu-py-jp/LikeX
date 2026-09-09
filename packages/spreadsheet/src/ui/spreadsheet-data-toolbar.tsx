"use client";

import { useState } from "react";
import { cellAddress } from "../model/address";
import { normalizeDataValidation, type SpreadsheetDataValidation } from "../model/data-validation";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { selectedAddresses } from "../state/selection";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { Command } from "./spreadsheet-controls";

type Target = { sheetId: string; addresses: string[]; revision: number; rule?: SpreadsheetDataValidation };

function ValidationDialog({ controller: c, target, onClose }: { controller: SpreadsheetController; target: Target; onClose: () => void }) {
  const rule = target.rule;
  const [type, setType] = useState<SpreadsheetDataValidation["type"]>(rule?.type ?? "list");
  const [values, setValues] = useState(rule?.type === "list" ? rule.values.join("\n") : "未着手\n進行中\n完了");
  const [minimum, setMinimum] = useState(rule && "min" in rule && rule.min !== undefined ? String(rule.min) : "");
  const [maximum, setMaximum] = useState(rule && "max" in rule && rule.max !== undefined ? String(rule.max) : "");
  const [integer, setInteger] = useState(rule?.type === "number" && !!rule.integer);
  const [allowBlank, setAllowBlank] = useState(rule?.allowBlank !== false);
  const [message, setMessage] = useState(rule?.message ?? "");
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const disabled = c.disabled || c.requesting || pending;
  const apply = async (remove = false) => {
    if (disabled) return;
    if (c.getRevision() !== target.revision) { setError("セルの状態が変わりました。ダイアログを閉じて指定し直してください。"); return; }
    try {
      const common = { allowBlank, ...(message ? { message } : {}) };
      const validation = remove ? null : normalizeDataValidation(type === "list" ? { type, values: values.split(/\r?\n/).filter(Boolean), ...common }
        : type === "checkbox" ? { type, ...common } : type === "date" ? { type, ...(minimum ? { min: minimum } : {}), ...(maximum ? { max: maximum } : {}), ...common }
          : { type, ...(minimum ? { min: Number(minimum) } : {}), ...(maximum ? { max: Number(maximum) } : {}), ...(type === "number" ? { integer } : {}), ...common })!;
      setPending(true); setError(null);
      const result = await c.executeCommand({ type: "cells.validation", sheetId: target.sheetId, addresses: target.addresses, validation });
      if (result.ok) onClose(); else setError(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "入力規則を設定できませんでした"); }
    finally { setPending(false); }
  };
  return <SpreadsheetDialog title="入力規則" onClose={onClose} actions={<>
    {target.rule && <button type="button" disabled={disabled} onClick={() => void apply(true)}>規則を解除</button>}
    <button type="button" onClick={onClose}>キャンセル</button><button type="button" disabled={disabled} onClick={() => void apply()}>適用</button>
  </>}>
    <div className="lxs-validation-fields">
      <p className="lxs-validation-hint">{target.addresses.length.toLocaleString()} セルに適用します。既存の値も規則に従う必要があります。</p>
      <label>許可する値<select value={type} disabled={disabled} onChange={event => { setType(event.target.value as typeof type); setMinimum(""); setMaximum(""); }}>
        <option value="list">リスト</option><option value="number">数値</option><option value="textLength">文字数</option><option value="date">日付</option>
        {c.features.checkboxes && <option value="checkbox">チェックボックス</option>}
      </select></label>
      {type === "list" && <label>選択肢（1行に1つ）<textarea value={values} disabled={disabled} onChange={event => setValues(event.target.value)} /></label>}
      {type === "number" && <label className="lxs-validation-check"><input type="checkbox" checked={integer} disabled={disabled} onChange={event => setInteger(event.target.checked)} />整数のみ</label>}
      {(type === "number" || type === "textLength" || type === "date") && <div className="lxs-validation-bounds">
        <label>最小値<input type={type === "date" ? "date" : "number"} step={type === "number" && !integer ? "any" : 1} value={minimum} disabled={disabled} onChange={event => setMinimum(event.target.value)} /></label>
        <label>最大値<input type={type === "date" ? "date" : "number"} step={type === "number" && !integer ? "any" : 1} value={maximum} disabled={disabled} onChange={event => setMaximum(event.target.value)} /></label>
      </div>}
      {type === "date" && <p className="lxs-validation-hint">セルには YYYY-MM-DD 形式の日付を入力します。</p>}
      <label className="lxs-validation-check"><input type="checkbox" checked={allowBlank} disabled={disabled} onChange={event => setAllowBlank(event.target.checked)} />空白を許可する</label>
      <label>入力エラーのメッセージ<input maxLength={255} value={message} disabled={disabled} onChange={event => setMessage(event.target.value)} placeholder="省略すると標準のメッセージ" /></label>
      {error && <p className="lxs-validation-error" role="alert">{error}</p>}
    </div>
  </SpreadsheetDialog>;
}

export function SpreadsheetDataToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const [target, setTarget] = useState<Target | null>(null);
  const disabled = c.disabled || c.requesting || !!c.selectedDrawingId;
  const open = (checkbox = false) => {
    if (disabled || !c.features.dataValidation || (checkbox && !c.features.checkboxes)) return;
    c.afterCommit(() => {
      try {
        const addresses = selectedAddresses(c.selection), address = cellAddress(c.selection.focus.row, c.selection.focus.column);
        setTarget({ sheetId: c.activeSheet.id, addresses, revision: c.getRevision(), rule: checkbox ? { type: "checkbox" } : c.activeSheet.cells[address]?.validation });
      } catch (cause) { c.reportError(cause); }
    });
  };
  if (!c.features.dataValidation || c.readOnly) return null;
  return <div className="lxs-tool-group">
    <Command label="入力規則" disabled={disabled} onClick={() => open()}>入力規則</Command>
    {c.features.checkboxes && <Command label="チェックボックスを挿入" disabled={disabled} onClick={() => open(true)}>☑ チェックボックス</Command>}
    {target && <ValidationDialog controller={c} target={target} onClose={() => { c.cancelEditRequest(); setTarget(null); }} />}
  </div>;
}
