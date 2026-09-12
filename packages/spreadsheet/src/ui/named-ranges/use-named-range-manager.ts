"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { namedRangeAddress } from "../../model/named-ranges";
import { isMultiRangeSelection, selectionBounds } from "../../state/selection";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

export type NamedRangeDialogTarget = { sheetId: string; revision: number; id?: string; name: string; range: string };
const canBrowse = (c: SpreadsheetController) => c.features.namedRanges && !c.saving && !c.refreshing &&
  !c.contextMenuLocked && !c.pendingObjectEdit && c.getEditState().mode !== "requesting";

export function useNamedRangeManager(controller: SpreadsheetController) {
  const latest = useRef(controller);
  const mounted = useRef(false), operation = useRef(0);
  const [open, setOpen] = useState(false), [dialogTarget, setDialogTarget] = useState<NamedRangeDialogTarget | null>(null);
  useLayoutEffect(() => { latest.current = controller; }, [controller]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Invalidate before rendering children so a forbidden form unmounts and
  // cancels its owned permission request in the same commit.
  if (open && (!controller.features.namedRanges || controller.commentOpen)) setOpen(false);
  if (dialogTarget && (!controller.features.namedRanges || controller.readOnly ||
    (!controller.features.sheets && dialogTarget.sheetId !== controller.activeSheet.id))) setDialogTarget(null);

  const afterCommit = (action: (current: SpreadsheetController) => void) => {
    const current = latest.current;
    if (!canBrowse(current)) return;
    const token = ++operation.current;
    current.afterCommit(() => {
      const live = latest.current;
      if (mounted.current && token === operation.current && canBrowse(live)) action(live);
    });
  };
  const close = () => { operation.current++; setOpen(false); latest.current.requestGridFocus(); };
  const closeDialog = () => { operation.current++; latest.current.cancelEditRequest(); setDialogTarget(null); };
  const toggle = () => {
    if (open) { close(); return; }
    afterCommit(current => { current.setCommentOpen(false); setOpen(true); });
  };
  const openAdd = () => {
    const current = latest.current;
    if (current.disabled || current.readOnly || current.selectedDrawingId || isMultiRangeSelection(current.selection)) return;
    afterCommit(live => {
      if (live.disabled || live.readOnly || live.selectedDrawingId || isMultiRangeSelection(live.selection)) return;
      setDialogTarget({ sheetId: live.activeSheet.id, revision: live.getRevision(), name: "", range: namedRangeAddress(selectionBounds(live.selection)) });
    });
  };
  const select = (id: string) => afterCommit(current => {
    const definition = current.getWorkbook().namedRanges?.find(item => item.id === id);
    if (definition && !current.features.sheets && definition.sheetId !== current.activeSheet.id) return;
    if (!definition || !current.selectRangeInSheet(definition.sheetId,
      { row: definition.range.top, column: definition.range.left }, { row: definition.range.bottom, column: definition.range.right })) {
      current.reportError(new Error("名前付き範囲が見つかりません。一覧から選び直してください。")); return;
    }
    current.requestGridFocus();
  });
  const edit = (id: string) => {
    if (latest.current.disabled || latest.current.readOnly) return;
    afterCommit(current => {
      if (current.disabled || current.readOnly) return;
      const definition = current.getWorkbook().namedRanges?.find(item => item.id === id);
      if (!definition) { current.reportError(new Error("名前付き範囲が見つかりません。一覧から選び直してください。")); return; }
      if (!current.features.sheets && definition.sheetId !== current.activeSheet.id) return;
      setDialogTarget({ id: definition.id, sheetId: definition.sheetId, revision: current.getRevision(), name: definition.name, range: namedRangeAddress(definition.range) });
    });
  };
  return { open: open && controller.features.namedRanges && !controller.commentOpen,
    dialogTarget: controller.features.namedRanges && !controller.readOnly &&
      (controller.features.sheets || dialogTarget?.sheetId === controller.activeSheet.id) ? dialogTarget : null,
    openAdd, toggle, close, select, edit, closeDialog };
}

export type NamedRangeManager = ReturnType<typeof useNamedRangeManager>;
