"use client";

import { useState } from "react";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { SpreadsheetDialog } from "../spreadsheet-dialog";
import { useSpreadsheetDialogCommand } from "../use-spreadsheet-dialog-command";
import type { NamedRangeDialogTarget } from "./use-named-range-manager";

export function NamedRangeDialog({ controller: c, target, onClose }: {
  controller: SpreadsheetController; target: NamedRangeDialogTarget; onClose: () => void;
}) {
  const [name, setName] = useState(target.name), [range, setRange] = useState(target.range);
  const [clear, setClear] = useState<"none" | "values" | "all">("none");
  const action = useSpreadsheetDialogCommand(c, target.revision);
  const stale = c.getRevision() !== target.revision;
  const sheet = c.workbook.sheets.find(item => item.id === target.sheetId);
  const disabled = action.disabled || stale || !sheet || c.readOnly || !c.features.namedRanges || c.pendingObjectEdit ||
    (!c.features.sheets && target.sheetId !== c.activeSheet.id);
  const save = () => {
    if (disabled) return;
    void action.run(target.id
      ? { type: "namedRanges.update", sheetId: target.sheetId, namedRangeId: target.id, name: name.trim(), range: range.trim() }
      : { type: "namedRanges.add", sheetId: target.sheetId, name: name.trim(), range: range.trim() }, onClose);
  };
  const remove = () => {
    if (disabled || !target.id) return;
    void action.run({ type: "namedRanges.delete", sheetId: target.sheetId, namedRangeId: target.id,
      ...(clear !== "none" ? { clear } : {}) }, onClose);
  };
  return <SpreadsheetDialog title="名前付き範囲" onClose={onClose} actions={<>
    {target.id && <button type="button" disabled={disabled} onClick={remove}>削除</button>}
    <button type="button" onClick={onClose}>キャンセル</button>
    <button type="button" disabled={disabled || !name.trim() || !range.trim()} onClick={save}>{target.id ? "更新" : "追加"}</button>
  </>}>
    <p className="lxs-named-range-target">対象シート: {sheet?.name ?? "シートが見つかりません"}</p>
    <label>範囲名<input value={name} maxLength={255} disabled={disabled} onChange={event => setName(event.target.value)} placeholder="売上明細" /></label>
    <label>セル範囲<input value={range} disabled={disabled} onChange={event => setRange(event.target.value)} placeholder="A1:C10" /></label>
    <p>同じシートの連続した範囲を指定します。名前はブック全体で重複できません。</p>
    {target.id && <>
      <label>削除時のセル<select value={clear} disabled={disabled} onChange={event => setClear(event.target.value as typeof clear)}>
        <option value="none">そのまま残す（定義だけ削除）</option>
        <option value="values">値をクリア</option>
        <option value="all">値・書式・コメント・入力規則をクリア</option>
      </select></label>
      {clear !== "none" && <p>指定範囲のセルもクリアします。ほかのセルの位置は動かしません。</p>}
    </>}
    {(stale || action.error) && <p role="alert">{stale ? "ブックの状態が変わりました。ダイアログを閉じて指定し直してください。" : action.error}</p>}
  </SpreadsheetDialog>;
}
