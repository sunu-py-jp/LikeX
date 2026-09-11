"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetProps } from "./props";
import { useSpreadsheet } from "./state/use-spreadsheet";
import { useSpreadsheetClipboard } from "./state/use-spreadsheet-clipboard";
import { SpreadsheetGrid } from "./ui/spreadsheet-grid";
import { SpreadsheetFormulaBar, SpreadsheetToolbar } from "./ui/spreadsheet-toolbar";
import { SpreadsheetFooter } from "./ui/spreadsheet-footer";
import { SpreadsheetComments } from "./ui/spreadsheet-comments";
import { useSpreadsheetHandle } from "./api/use-spreadsheet-handle";
import { useUnsavedChangesGuard } from "./state/use-unsaved-changes-guard";
import { useSpreadsheetContextMenu } from "./state/use-spreadsheet-context-menu";
import { SpreadsheetContextMenu } from "./ui/spreadsheet-context-menu";

export default function Spreadsheet({ ref: handleRef, ...props }: SpreadsheetProps) {
  const c = useSpreadsheet(props);
  useSpreadsheetHandle(handleRef, c);
  const root = useRef<HTMLElement>(null);
  const gridHadFocus = useRef(false);
  const focusedViewRevision = useRef(c.viewRevision);
  useLayoutEffect(() => {
    // History replaces the keyed grid to cancel stale gestures and editors.
    // Keep focus on the selected object, or the active cell, so shortcuts repeat
    // without redirecting a drawing operation to the cells underneath it.
    if (focusedViewRevision.current === c.viewRevision) return;
    focusedViewRevision.current = c.viewRevision;
    if (!gridHadFocus.current || !root.current) return;
    const drawing = c.selectedDrawingId ? Array.from(root.current.querySelectorAll<HTMLElement>("[data-lxs-drawing]"))
      .find(element => element.dataset.lxsDrawing === c.selectedDrawingId) : undefined;
    (drawing ?? root.current.querySelector<HTMLTextAreaElement>(".lxs-cell-input"))?.focus({ preventScroll: true });
  }, [c.viewRevision, c.selectedDrawingId]);
  const clipboard = useSpreadsheetClipboard(c);
  const contextMenu = useSpreadsheetContextMenu(c, props, root, clipboard);
  useUnsavedChangesGuard(root, props.warnOnUnsavedChanges !== false && c.hasUnsavedChanges);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (props.colorMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [props.colorMode]);
  const dark = props.colorMode === "dark" || (props.colorMode === "system" && systemDark);
  return <section ref={root} data-likex-spreadsheet data-color-mode={dark ? "dark" : "light"} className={`lxs-root ${props.className ?? ""}`} style={props.style} role="region" aria-label={props["aria-label"] ?? "スプレッドシート"} aria-busy={c.exporting || c.saving || c.refreshing || c.requesting || contextMenu.state.phase !== "idle"}
    onContextMenu={contextMenu.onContextMenu} onPointerDownCapture={contextMenu.onPointerDownCapture} onKeyDownCapture={contextMenu.onKeyDownCapture}
    onFocusCapture={event => { gridHadFocus.current = !!(event.target as HTMLElement).closest(".lxs-grid-scroll"); }}
    onBlurCapture={event => {
      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node) ||
        !(event.relatedTarget as HTMLElement).closest(".lxs-grid-scroll")) gridHadFocus.current = false;
    }}
    onCopy={clipboard.onCopy} onCut={clipboard.onCut} onPaste={clipboard.onPaste}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
      if (event.key === "Escape" && contextMenu.state.phase !== "idle") { event.preventDefault(); contextMenu.cancel(); return; }
      if (event.key === "Escape" && c.requesting) { event.preventDefault(); c.cancelEditRequest(); return; }
      const primary = (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey);
      if (!primary) return;
      const key = event.key.toLowerCase();
      if ((key === "f" && c.features.search) || (key === "h" && c.features.replace && !c.readOnly)) {
        const trigger = root.current?.querySelector<HTMLButtonElement>(key === "f" ? "[data-lxs-find]" : "[data-lxs-replace]");
        if (trigger && !trigger.disabled) { event.preventDefault(); trigger.click(); }
        return;
      }
      if (key === "s" && !c.readOnly && c.features.save) { event.preventDefault(); void c.save(); }
      const textControl = (event.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
      // Ribbon selectors change the workbook; they have no native text-edit history.
      // Genuine text editors (including dialogs and the formula bar) retain native Undo.
      const ribbonSetting = textControl?.closest(".lxs-ribbon-container") &&
        (textControl.tagName === "SELECT" || textControl.matches("input[type='color'], input[type='checkbox'], input[type='radio'], input[type='range']"));
      if (textControl && !textControl.classList.contains("lxs-cell-input") && !ribbonSetting) return;
      if (c.features.undoRedo && !c.readOnly && !c.editing && (key === "z" || key === "y")) { event.preventDefault(); if (key === "y" || event.shiftKey) c.redo(); else c.undo(); }
      if (key === "a" && !c.editing && (event.target as HTMLElement).closest(".lxs-grid")) { event.preventDefault(); c.selectRange({ row: c.activeSheet.rowCount - 1, column: c.activeSheet.columnCount - 1 }, { row: 0, column: 0 }); }
    }}>
    <header className="lxs-title-bar"><span className="lxs-app-mark" aria-hidden="true">▦</span><span className="lxs-title">{props.title?.trim() || "スプレッドシート"}</span><span className="lxs-title-context">LikeX</span></header>
    <SpreadsheetToolbar controller={c} clipboard={clipboard} />
    <SpreadsheetFormulaBar controller={c} />
    <div className="lxs-sheet-workspace">
      <SpreadsheetGrid key={`grid-${c.viewRevision}`} controller={c} />
      <SpreadsheetComments key={`comments-${c.viewRevision}`} controller={c} />
    </div>
    <SpreadsheetFooter key={`footer-${c.viewRevision}`} controller={c} />
    <SpreadsheetContextMenu controller={contextMenu} root={root} />
  </section>;
}
