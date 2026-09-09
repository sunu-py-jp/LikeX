"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type ReactNode } from "react";
import { createContextMenuExecutor, resolveContextMenuItems, type ContextMenuExecutor, type ContextMenuExecutionState } from "../core";
import { cellAddress } from "../model";
import type { SpreadsheetProps } from "../props";
import type { SpreadsheetContextMenuChange, SpreadsheetContextMenuContext, SpreadsheetContextMenuItem } from "../api/context-menu";
import type { SpreadsheetController } from "./use-spreadsheet";

type CapturedContext = SpreadsheetContextMenuContext & { readonly structureRevision: number };
export type SpreadsheetOpenContextMenu = {
  context: CapturedContext; items: readonly SpreadsheetContextMenuItem[];
  deleteSheet: { disabled: boolean } | null;
  x: number; y: number; returnFocus: HTMLElement | null;
};

/** Captures targets separately from selection and sends only proposed commands to the shared executor. */
export function useSpreadsheetContextMenu(c: SpreadsheetController, props: SpreadsheetProps, root: RefObject<HTMLElement | null>) {
  const latest = useRef({ c, props });
  useLayoutEffect(() => { latest.current = { c, props }; });
  const mounted = useRef(false);
  const owner = useRef({});
  const [menu, setMenu] = useState<SpreadsheetOpenContextMenu | null>(null);
  const [state, setState] = useState<ContextMenuExecutionState>({ phase: "idle", mode: "block", requestId: null,
    itemId: null, label: "", description: "", error: null, blocksChanges: false });
  const executorRef = useRef<ContextMenuExecutor<CapturedContext, SpreadsheetContextMenuChange> | null>(null);
  useLayoutEffect(() => {
    const executor = createContextMenuExecutor<CapturedContext, SpreadsheetContextMenuChange>({
    getRevision: () => latest.current.c.getRevision(),
    canRun: () => mounted.current && !!latest.current.props.getContextMenuItems && !latest.current.c.saving && !latest.current.c.refreshing &&
      !latest.current.c.requesting && !latest.current.c.editing && !latest.current.c.pendingObjectEdit,
    prepareChange: change => structuredClone(change),
    validateTarget: context => {
      const current = latest.current.c;
      const sheet = current.getWorkbook().sheets.find(sheet => sheet.id === context.target.sheetId);
      if (!sheet || (context.target.kind === "cell" && (current.getStructureRevision() !== context.structureRevision ||
        context.target.row >= sheet.rowCount || context.target.column >= sheet.columnCount)))
        throw new Error("シートや行・列の構成が変わりました。対象を確認して操作し直してください");
    },
    apply: async (change, _context, operation, guard) => {
      const current = latest.current.c;
      const cancelPermission = () => latest.current.c.cancelEditRequest();
      operation.signal.addEventListener("abort", cancelPermission, { once: true });
      try {
        const result = await current.applyContextMenuCommands(change, owner.current, guard.isCurrent);
        if (!result.ok) throw new Error(result.message);
      } finally { operation.signal.removeEventListener("abort", cancelPermission); }
    },
    onStateChange: next => {
      latest.current.c.setContextMenuLock(next.blocksChanges ? owner.current : null);
      if (mounted.current) setState(next);
    },
    onEvent: event => latest.current.c.emitEvent(event),
    });
    executorRef.current = executor;
    mounted.current = true;
    return () => {
      mounted.current = false; executor.cancel(); executorRef.current = null;
      latest.current.c.setContextMenuLock(null); setState(executor.getState()); setMenu(null);
    };
  }, []);
  const policy = useRef({ mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly,
    sheets: c.features.sheets, deleteSheet: c.features.deleteSheet });
  useLayoutEffect(() => {
    const before = policy.current;
    if (before.mode !== props.contextMenuExecutionMode || (before.enabled && !props.getContextMenuItems) || before.readOnly !== c.readOnly) {
      executorRef.current?.cancel(); setMenu(null);
    }
    if (before.sheets !== c.features.sheets || before.deleteSheet !== c.features.deleteSheet) setMenu(null);
    policy.current = { mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly,
      sheets: c.features.sheets, deleteSheet: c.features.deleteSheet };
  }, [props.contextMenuExecutionMode, props.getContextMenuItems, c.readOnly, c.features.sheets, c.features.deleteSheet]);

  const closeMenu = () => setMenu(null);
  const eligibleTarget = (target: EventTarget | null): HTMLElement | null => {
    const element = target as HTMLElement | null;
    if (!element?.closest || c.editing || c.pendingObjectEdit) return null;
    const editor = element.closest("input,textarea,select,[contenteditable='true']");
    if (editor && !editor.classList.contains("lxs-cell-input")) return null;
    const tab = c.features.sheets ? element.closest<HTMLElement>("[data-lxs-sheet-id]") : null;
    return tab ?? (props.getContextMenuItems ? element.closest<HTMLElement>("[data-lxs-row][data-lxs-column]") : null);
  };
  const open = (element: HTMLElement, x: number, y: number) => {
    if (executorRef.current?.getState().phase !== "idle" || c.saving || c.refreshing || c.requesting) return;
    const workbook = c.getWorkbook();
    let target: SpreadsheetContextMenuContext["target"];
    if (element.dataset.lxsSheetId !== undefined) {
      const index = workbook.sheets.findIndex(sheet => sheet.id === element.dataset.lxsSheetId);
      if (index < 0) return;
      const sheet = workbook.sheets[index];
      target = { kind: "sheet", sheetId: sheet.id, name: sheet.name, index };
    } else {
      const row = Number(element.dataset.lxsRow), column = Number(element.dataset.lxsColumn);
      if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 ||
        row >= c.activeSheet.rowCount || column >= c.activeSheet.columnCount) return;
      target = { kind: "cell", sheetId: c.activeSheet.id, row, column, address: cellAddress(row, column) };
    }
    const selection = structuredClone(c.selection);
    const context: CapturedContext = Object.freeze({
      target: Object.freeze(target),
      selection, workbook, features: Object.freeze({ ...c.features }), readOnly: c.readOnly,
      structureRevision: c.getStructureRevision(),
    });
    try {
      const items = resolveContextMenuItems<SpreadsheetContextMenuContext, SpreadsheetContextMenuChange, ReactNode>(props.getContextMenuItems, context);
      const deleteSheet = target.kind === "sheet" && c.features.deleteSheet && !c.readOnly ?
        { disabled: c.disabled || workbook.sheets.length < 2 } : null;
      if (items.length || deleteSheet) setMenu({ context, items, deleteSheet, x, y,
        returnFocus: root.current?.ownerDocument.activeElement as HTMLElement | null });
    } catch (error) { c.reportError(error); }
  };
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target = eligibleTarget(event.target);
    if (!target) return;
    event.preventDefault();
    open(target, event.clientX, event.clientY);
  };
  const onPointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    if (event.button === 2 && eligibleTarget(event.target)) event.preventDefault();
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    const target = eligibleTarget(event.target);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    const rect = target.getBoundingClientRect();
    open(target, rect.left + Math.min(rect.width, 24), rect.bottom);
  };
  const selectItem = (item: SpreadsheetContextMenuItem) => {
    if (!menu || item.disabled || !latest.current.props.getContextMenuItems) return;
    const context = menu.context;
    closeMenu();
    void executorRef.current?.run(item, context, latest.current.props.contextMenuExecutionMode ?? "block");
  };
  const deleteSheet = () => {
    if (!menu?.deleteSheet || menu.deleteSheet.disabled || menu.context.target.kind !== "sheet") return;
    const current = latest.current.c, sheetId = menu.context.target.sheetId;
    closeMenu();
    if (!current.features.deleteSheet || current.readOnly || current.disabled || current.requesting || current.pendingObjectEdit ||
      current.getWorkbook().sheets.length < 2 || !current.getWorkbook().sheets.some(sheet => sheet.id === sheetId)) return;
    current.afterCommit(() => latest.current.c.afterCommand({ type: "sheets.delete", sheetId }));
  };
  const visibleMenu = menu?.context.target.kind === "sheet" ? (c.features.sheets ? menu : null) : (props.getContextMenuItems ? menu : null);
  return { menu: visibleMenu, state, closeMenu, selectItem, deleteSheet, cancel: () => executorRef.current?.cancel(), confirm: () => { void executorRef.current?.confirm(); },
    onContextMenu, onPointerDownCapture, onKeyDownCapture };
}

export type SpreadsheetContextMenuController = ReturnType<typeof useSpreadsheetContextMenu>;
