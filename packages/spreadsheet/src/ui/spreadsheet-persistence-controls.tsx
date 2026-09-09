"use client";

import { useState } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { SpreadsheetConfirmDialog } from "./spreadsheet-confirm-dialog";
import { Command, Icon } from "./spreadsheet-controls";

/** Persistence remains host-owned; only the user confirmation belongs to the view. */
export function SpreadsheetPersistenceControls({ controller: c }: { controller: SpreadsheetController }) {
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const busy = c.saving || c.refreshing || c.requesting;
  const refresh = () => {
    if (busy || !c.canRefresh) return;
    if (c.hasUnsavedChanges) setConfirmRefresh(true);
    else void c.refresh();
  };
  return <div className="lxs-persistence-controls">
    {c.requesting && <><span role="status" className="lxs-operation-status">編集許可を確認しています…</span>
      <Command label="編集許可の確認をキャンセル" onClick={c.cancelEditRequest}><Icon name="close" /></Command></>}
    {c.canRefresh && <Command label="再読み込み" disabled={busy} onClick={refresh}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3" /></svg>
    </Command>}
    {c.refreshing && <span role="status" className="lxs-operation-status">再読み込み中…</span>}
    {c.readOnly ? <span className="lxs-readonly">読み取り専用</span> : c.features.save &&
      <button type="button" className="lxs-save" disabled={busy || !c.hasUnsavedChanges} onClick={() => void c.save()}>
        <Icon name="save" />{c.saving ? "保存中…" : "保存"}
      </button>}
    {confirmRefresh && <SpreadsheetConfirmDialog title="変更を破棄して再読み込みしますか？" confirmLabel="再読み込み" disabled={busy || !c.canRefresh}
      onCancel={() => setConfirmRefresh(false)} onConfirm={() => {
        setConfirmRefresh(false);
        void c.refresh({ discardChanges: true });
      }}>
      未保存の変更があります。新しいデータを読み込むと、この画面の変更は破棄されます。
    </SpreadsheetConfirmDialog>}
  </div>;
}
