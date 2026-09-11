"use client";

import { useState } from "react";
import type { SpreadsheetPasteMode } from "../api/editing-commands";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import type { useSpreadsheetClipboard } from "../state/use-spreadsheet-clipboard";
import { SpreadsheetSearchDialog } from "./spreadsheet-search-dialog";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetEditToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const [search, setSearch] = useState<"find" | "replace" | null>(null);
  const blocked = c.saving || c.refreshing || c.requesting || c.pendingObjectEdit;
  const open = (mode: "find" | "replace") => c.afterCommit(() => setSearch(mode));
  return <>
    {(c.features.search || c.features.replace && !c.readOnly) && <div className="lxs-ribbon-stack lxs-edit-tools">
      {c.features.search && <Command label="検索" className="lxs-ribbon-command-label" data-lxs-find title="検索 (Ctrl+F)" disabled={blocked} onClick={() => open("find")}><Icon name="search" /><span>検索</span></Command>}
      {c.features.replace && !c.readOnly && <Command label="置換" className="lxs-ribbon-command-label" data-lxs-replace title="置換 (Ctrl+H)" disabled={blocked || c.disabled} onClick={() => open("replace")}><Icon name="replace" /><span>置換</span></Command>}
    </div>}
    {search && (search === "find" ? c.features.search : c.features.replace && !c.readOnly) && <SpreadsheetSearchDialog key={search} controller={c} initialMode={search} onClose={() => setSearch(null)} />}
  </>;
}

/** Paste options belong to the Clipboard group; search state stays in the Editing group. */
export function SpreadsheetPasteSpecialControl({ controller: c, clipboard }: {
  controller: SpreadsheetController; clipboard: ReturnType<typeof useSpreadsheetClipboard>;
}) {
  if (!c.features.pasteSpecial || c.readOnly) return null;
  const modes: { value: SpreadsheetPasteMode; label: string; enabled: boolean }[] = [
    { value: "all", label: "すべて貼り付け", enabled: true }, { value: "values", label: "値のみ貼り付け", enabled: true },
    { value: "formulas", label: "数式のみ貼り付け", enabled: c.features.formulas }, { value: "formats", label: "書式のみ貼り付け", enabled: c.features.formatting },
  ];
  return <select className="lxs-select lxs-paste-special" aria-label="形式を選択して貼り付け" title="形式を選択して貼り付け"
    disabled={c.saving || c.refreshing || c.requesting || c.pendingObjectEdit || c.disabled || !!c.selectedDrawingId} value="" onChange={event => {
      const mode = event.target.value as SpreadsheetPasteMode;
      c.afterCommit(() => { void clipboard.paste(mode); });
    }}><option value="" disabled>形式を選択</option>{modes.filter(mode => mode.enabled).map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>;
}
