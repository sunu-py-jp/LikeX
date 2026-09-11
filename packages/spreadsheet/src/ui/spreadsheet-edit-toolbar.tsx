"use client";

import { useState } from "react";
import type { SpreadsheetPasteMode } from "../api/editing-commands";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import type { useSpreadsheetClipboard } from "../state/use-spreadsheet-clipboard";
import { SpreadsheetSearchDialog } from "./spreadsheet-search-dialog";

export function SpreadsheetEditToolbar({ controller: c, clipboard }: { controller: SpreadsheetController; clipboard: ReturnType<typeof useSpreadsheetClipboard> }) {
  const [search, setSearch] = useState<"find" | "replace" | null>(null);
  const blocked = c.saving || c.refreshing || c.requesting || c.pendingObjectEdit;
  const open = (mode: "find" | "replace") => c.afterCommit(() => setSearch(mode));
  const modes: { value: SpreadsheetPasteMode; label: string; enabled: boolean }[] = [
    { value: "all", label: "すべて貼り付け", enabled: true }, { value: "values", label: "値のみ貼り付け", enabled: true },
    { value: "formulas", label: "数式のみ貼り付け", enabled: c.features.formulas }, { value: "formats", label: "書式のみ貼り付け", enabled: c.features.formatting },
  ];
  return <>
    {(c.features.search || c.features.replace && !c.readOnly || c.features.pasteSpecial && !c.readOnly) && <div className="lxs-tool-group lxs-edit-tools">
      {c.features.search && <button type="button" className="lxs-command" data-lxs-find title="検索 (Ctrl+F)" disabled={blocked} onClick={() => open("find")}>検索</button>}
      {c.features.replace && !c.readOnly && <button type="button" className="lxs-command" data-lxs-replace title="置換 (Ctrl+H)" disabled={blocked || c.disabled} onClick={() => open("replace")}>置換</button>}
      {c.features.pasteSpecial && !c.readOnly && <select className="lxs-paste-special" aria-label="形式を選択して貼り付け" disabled={blocked || c.disabled || !!c.selectedDrawingId} value="" onChange={event => {
        const mode = event.target.value as SpreadsheetPasteMode;
        c.afterCommit(() => { void clipboard.paste(mode); });
      }}><option value="" disabled>形式を選択して貼り付け</option>{modes.filter(mode => mode.enabled).map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>}
    </div>}
    {search && (search === "find" ? c.features.search : c.features.replace && !c.readOnly) && <SpreadsheetSearchDialog key={search} controller={c} initialMode={search} onClose={() => setSearch(null)} />}
  </>;
}
