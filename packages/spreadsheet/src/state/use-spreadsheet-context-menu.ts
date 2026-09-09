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
      if (current.getStructureRevision() !== context.structureRevision || !sheet || context.target.row >= sheet.rowCount || context.target.column >= sheet.columnCount)
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
  const policy = useRef({ mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly });
  useLayoutEffect(() => {
    const before = policy.current;
    if (before.mode !== props.contextMenuExecutionMode || (before.enabled && !props.getContextMenuItems) || before.readOnly !== c.readOnly) executorRef.current?.cancel();
    policy.current = { mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly };
  }, [props.contextMenuExecutionMode, props.getContextMenuItems, c.readOnly]);

  const closeMenu = () => setMenu(null);
  const eligibleCell = (target: EventTarget | null): HTMLElement | null => {
    const element = target as HTMLElement | null;
    if (!element?.closest || !props.getContextMenuItems || c.editing || c.pendingObjectEdit) return null;
    const editor = element.closest("input,textarea,select,[contenteditable='true']");
    if (editor && !editor.classList.contains("lxs-cell-input")) return null;
    return element.closest<HTMLElement>("[data-lxs-row][data-lxs-column]");
  };
  const open = (cell: HTMLElement, x: number, y: number) => {
    if (executorRef.current?.getState().phase !== "idle" || c.saving || c.refreshing || c.requesting) return;
    const row = Number(cell.dataset.lxsRow), column = Number(cell.dataset.lxsColumn);
    if (!Number.isInteger(row) || !Number.isInteger(column)) return;
    const selection = structuredClone(c.selection);
    const context: CapturedContext = Object.freeze({
      target: Object.freeze({ kind: "cell", sheetId: c.activeSheet.id, row, column, address: cellAddress(row, column) }),
      selection, workbook: c.getWorkbook(), features: Object.freeze({ ...c.features }), readOnly: c.readOnly,
      structureRevision: c.getStructureRevision(),
    });
    try {
      const items = resolveContextMenuItems<SpreadsheetContextMenuContext, SpreadsheetContextMenuChange, ReactNode>(props.getContextMenuItems, context);
      if (items.length) setMenu({ context, items, x, y,
        returnFocus: root.current?.ownerDocument.activeElement as HTMLElement | null });
    } catch (error) { c.reportError(error); }
  };
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const cell = eligibleCell(event.target);
    if (!cell) return;
    event.preventDefault();
    open(cell, event.clientX, event.clientY);
  };
  const onPointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    if (event.button === 2 && eligibleCell(event.target)) event.preventDefault();
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    const cell = eligibleCell(event.target);
    if (!cell) return;
    event.preventDefault(); event.stopPropagation();
    const rect = cell.getBoundingClientRect();
    open(cell, rect.left + Math.min(rect.width, 24), rect.bottom);
  };
  const selectItem = (item: SpreadsheetContextMenuItem) => {
    if (!menu || item.disabled || !latest.current.props.getContextMenuItems) return;
    const context = menu.context;
    closeMenu();
    void executorRef.current?.run(item, context, latest.current.props.contextMenuExecutionMode ?? "block");
  };
  return { menu: props.getContextMenuItems ? menu : null, state, closeMenu, selectItem, cancel: () => executorRef.current?.cancel(), confirm: () => { void executorRef.current?.confirm(); },
    onContextMenu, onPointerDownCapture, onKeyDownCapture };
}

export type SpreadsheetContextMenuController = ReturnType<typeof useSpreadsheetContextMenu>;
