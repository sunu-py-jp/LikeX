"use client";

import { useState } from "react";
import type { SpreadsheetNamedRange } from "../model/types";
import { namedRangeAddress } from "../model/named-ranges";
import { isMultiRangeSelection, selectionBounds } from "../state/selection";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { Command, Icon } from "./spreadsheet-controls";
import { RibbonGroup } from "./spreadsheet-ribbon-group";
import { SpreadsheetDialog } from "./spreadsheet-dialog";
import { useSpreadsheetDialogCommand } from "./use-spreadsheet-dialog-command";

type NamedRangeTarget = { sheetId: string; address: string; revision: number; definitions: readonly SpreadsheetNamedRange[] };

function NamedRangeDialog({ controller: c, target, onClose }: {
  controller: SpreadsheetController; target: NamedRangeTarget; onClose: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [range, setRange] = useState(target.address);
  const [clear, setClear] = useState<"none" | "values" | "all">("none");
  const action = useSpreadsheetDialogCommand(c, target.revision);
  const choose = (nextId: string) => {
    const definition = target.definitions.find(item => item.id === nextId);
    setId(nextId); setName(definition?.name ?? ""); setRange(definition ? namedRangeAddress(definition.range) : target.address);
    setClear("none"); action.setError(null);
  };
  const save = () => void action.run(id
    ? { type: "namedRanges.update", sheetId: target.sheetId, namedRangeId: id, name: name.trim(), range: range.trim() }
    : { type: "namedRanges.add", sheetId: target.sheetId, name: name.trim(), range: range.trim() }, onClose);
  const remove = () => void action.run({ type: "namedRanges.delete", sheetId: target.sheetId, namedRangeId: id,
    ...(clear !== "none" ? { clear } : {}) }, onClose);

  return <SpreadsheetDialog title="名前付き範囲" onClose={onClose} actions={<>
    {id && <button type="button" disabled={action.disabled} onClick={remove}>削除</button>}
    <button type="button" onClick={onClose}>キャンセル</button>
    <button type="button" disabled={action.disabled || !name.trim() || !range.trim()} onClick={save}>{id ? "更新" : "追加"}</button>
  </>}>
    <label>編集する範囲<select value={id} disabled={action.disabled} onChange={event => choose(event.target.value)}>
      <option value="">新しい範囲</option>
      {target.definitions.map(item => <option key={item.id} value={item.id}>{item.name} ({namedRangeAddress(item.range)})</option>)}
    </select></label>
    <label>範囲名<input value={name} maxLength={255} disabled={action.disabled} onChange={event => setName(event.target.value)} placeholder="売上明細" /></label>
    <label>セル範囲<input value={range} disabled={action.disabled} onChange={event => setRange(event.target.value)} placeholder="A1:C10" /></label>
    <p>現在のシートの連続した範囲に名前を付けます。名前はブック全体で重複できません。</p>
    {id && <>
      <label>削除時のセル<select value={clear} disabled={action.disabled} onChange={event => setClear(event.target.value as typeof clear)}>
        <option value="none">そのまま残す（定義だけ削除）</option>
        <option value="values">値をクリア</option>
        <option value="all">値・書式・コメント・入力規則をクリア</option>
      </select></label>
      {clear !== "none" && <p>指定範囲のセルもクリアします。ほかのセルの位置は動かしません。</p>}
    </>}
    {action.error && <p role="alert">{action.error}</p>}
  </SpreadsheetDialog>;
}

export function SpreadsheetNamedRanges({ controller: c }: { controller: SpreadsheetController }) {
  const [target, setTarget] = useState<NamedRangeTarget | null>(null);
  const multiple = isMultiRangeSelection(c.selection);
  const disabled = c.disabled || c.requesting || c.pendingObjectEdit || !!c.selectedDrawingId || multiple;
  if (c.readOnly || !c.features.namedRanges) return null;
  const open = () => {
    if (disabled) return;
    c.afterCommit(() => setTarget({ sheetId: c.activeSheet.id, address: namedRangeAddress(selectionBounds(c.selection)),
      revision: c.getRevision(), definitions: c.getWorkbook().namedRanges?.filter(item => item.sheetId === c.activeSheet.id) ?? [] }));
  };
  return <><RibbonGroup label="名前付き範囲">
    <Command label="名前付き範囲" className="lxs-ribbon-command-large" disabled={disabled} title={multiple ? "1つの連続した範囲を選択してください" : undefined} onClick={open}><Icon name="namedRange" /><span>名前の管理</span></Command>
    </RibbonGroup>
    {target && <NamedRangeDialog controller={c} target={target} onClose={() => { c.cancelEditRequest(); setTarget(null); }} />}
  </>;
}
