"use client";

import { useEffect, useState } from "react";
import type { SpreadsheetProps } from "./props";
import { useSpreadsheet } from "./state/use-spreadsheet";
import { useSpreadsheetClipboard } from "./state/use-spreadsheet-clipboard";
import { SpreadsheetGrid } from "./ui/spreadsheet-grid";
import { SpreadsheetFormulaBar, SpreadsheetToolbar } from "./ui/spreadsheet-toolbar";
import { SpreadsheetFooter } from "./ui/spreadsheet-footer";

export default function Spreadsheet(props: SpreadsheetProps) {
  const c = useSpreadsheet(props);
  const clipboard = useSpreadsheetClipboard(c);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (props.colorMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [props.colorMode]);
  const dark = props.colorMode === "dark" || (props.colorMode === "system" && systemDark);
  return <section data-likex-spreadsheet data-color-mode={dark ? "dark" : "light"} className={`lxs-root ${props.className ?? ""}`} style={props.style} role="region" aria-label={props["aria-label"] ?? "スプレッドシート"} aria-busy={c.saving}
    onCopy={clipboard.onCopy} onCut={clipboard.onCut} onPaste={clipboard.onPaste}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
      const primary = (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey);
      if (!primary) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !c.readOnly) { event.preventDefault(); void c.save(); }
      const textControl = (event.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
      if (textControl && !textControl.classList.contains("lxs-cell-input")) return;
      if (c.features.undoRedo && !c.readOnly && !c.editing && (key === "z" || key === "y")) { event.preventDefault(); if (key === "y" || event.shiftKey) c.redo(); else c.undo(); }
      if (key === "a" && !c.editing && (event.target as HTMLElement).closest(".lxs-grid")) { event.preventDefault(); c.selectRange({ row: c.activeSheet.rowCount - 1, column: c.activeSheet.columnCount - 1 }, { row: 0, column: 0 }); }
    }}>
    <header className="lxs-title-bar"><span className="lxs-app-mark" aria-hidden="true">▦</span><span className="lxs-title">{props.title?.trim() || "スプレッドシート"}</span><span className="lxs-title-context">LikeX</span></header>
    <SpreadsheetToolbar controller={c} clipboard={clipboard} />
    <SpreadsheetFormulaBar controller={c} />
    <SpreadsheetGrid controller={c} />
    <SpreadsheetFooter controller={c} />
  </section>;
}
