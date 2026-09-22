"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type ReactNode } from "react";
import { chainResult, createContextMenuExecutor, resolveContextMenuItems, type ContextMenuExecutor, type ContextMenuExecutionState } from "../core";
import { cellAddress, copySpreadsheetDrawing } from "../model";
import type { SpreadsheetProps, SpreadsheetSelection } from "../props";
import type { SpreadsheetContextMenuChange, SpreadsheetContextMenuContext, SpreadsheetContextMenuItem } from "../api/context-menu";
import type { SpreadsheetController } from "./use-spreadsheet";
import type { useSpreadsheetClipboard } from "./use-spreadsheet-clipboard";
import type { SpreadsheetCommand } from "../api/types";
import { rangeBounds, selectionRanges } from "./selection";
import { cellMenuItems, contextStructureCommands, selectionAxisIndices, selectionForContextTarget, type CellMenuAction, type CellMenuItem } from "./context-menu/builtin-items";
import { autoFitCommand } from "./sizing/auto-fit-command";
import { drawingMenuItems, type DrawingMenuAction, type DrawingMenuItem } from "./context-menu/drawing-items";

type CapturedContext = SpreadsheetContextMenuContext & { readonly structureRevision: number };
export type SpreadsheetOpenContextMenu = {
  context: CapturedContext; items: readonly SpreadsheetContextMenuItem[];
  actionSelection: SpreadsheetSelection; builtIns: readonly (CellMenuItem | DrawingMenuItem)[]; revision: number;
  deleteSheet: { disabled: boolean } | null;
  duplicateSheet: { disabled: boolean } | null;
  renameSheet: { disabled: boolean } | null;
  x: number; y: number; returnFocus: HTMLElement | null;
};

/** Captures targets separately from selection and sends only proposed commands to the shared executor. */
export function useSpreadsheetContextMenu(c: SpreadsheetController, props: SpreadsheetProps, root: RefObject<HTMLElement | null>, clipboard: ReturnType<typeof useSpreadsheetClipboard>, onRenameSheet?: (sheetId: string) => void) {
  const latest = useRef({ c, props, clipboard, onRenameSheet });
  useLayoutEffect(() => { latest.current = { c, props, clipboard, onRenameSheet }; });
  const mounted = useRef(false);
  const owner = useRef({});
  const [menu, setMenu] = useState<SpreadsheetOpenContextMenu | null>(null);
  const [dialog, setDialog] = useState<{kind: "format" | "dimension" | "insert-cells" | "delete-cells"; axis: "row" | "column"; sheetId: string; selection: SpreadsheetSelection; revision: number} | null>(null);
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
      if (!sheet || (context.target.kind !== "sheet" && (current.getStructureRevision() !== context.structureRevision ||
        ("row" in context.target && context.target.row >= sheet.rowCount) || ("column" in context.target && context.target.column >= sheet.columnCount))))
        throw new Error("シートや行・列の構成が変わりました。対象を確認して操作し直してください");
      if (context.target.kind === "drawing") {
        const target = context.target;
        if (!sheet.drawings?.some(item => item.id === target.drawingId && item.type === target.drawingType))
          throw new Error("画像・図形が変更されました。対象を確認して操作し直してください");
      }
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
  const featureKey = JSON.stringify(c.features);
  const policy = useRef({ mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly,
    features: featureKey });
  useLayoutEffect(() => {
    const before = policy.current;
    if (before.mode !== props.contextMenuExecutionMode || (before.enabled && !props.getContextMenuItems) || before.readOnly !== c.readOnly) {
      executorRef.current?.cancel(); setMenu(null); setDialog(null);
    }
    if (before.features !== featureKey) { setMenu(null); setDialog(null); }
    policy.current = { mode: props.contextMenuExecutionMode, enabled: !!props.getContextMenuItems, readOnly: c.readOnly,
      features: featureKey };
  }, [props.contextMenuExecutionMode, props.getContextMenuItems, c.readOnly, featureKey]);

  const closeMenu = () => setMenu(null);
  const eligibleTarget = (target: EventTarget | null): HTMLElement | null => {
    const element = target as HTMLElement | null;
    if (!element?.closest || c.editing || c.pendingObjectEdit || dialog || element.closest("[role='separator']")) return null;
    const editor = element.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])");
    if (editor && !editor.classList.contains("lxs-cell-input")) return null;
    const tab = c.features.sheets ? element.closest<HTMLElement>("[data-lxs-sheet-id]") : null;
    return tab ?? element.closest<HTMLElement>("[data-lxs-drawing]") ?? element.closest<HTMLElement>("[data-lxs-row][data-lxs-column]") ??
      element.closest<HTMLElement>("[data-lxs-row-header]") ?? element.closest<HTMLElement>("[data-lxs-column-header]");
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
    } else if (element.dataset.lxsDrawing !== undefined) {
      const drawing = c.activeSheet.drawings?.find(item => item.id === element.dataset.lxsDrawing);
      if (!drawing || !c.features[drawing.type === "image" ? "images" : drawing.type === "shape" ? "shapes" : "textBoxes"]) return;
      // A right-click selects the object without replacing the underlying cell ranges.
      if (c.selectDrawing(drawing.id) !== true) return;
      target = { kind: "drawing", sheetId: c.activeSheet.id, drawingId: drawing.id, drawingType: drawing.type };
    } else if (element.dataset.lxsRowHeader !== undefined || element.dataset.lxsColumnHeader !== undefined) {
      const row = element.dataset.lxsRowHeader !== undefined;
      const index = Number(row ? element.dataset.lxsRowHeader : element.dataset.lxsColumnHeader);
      if (!Number.isInteger(index) || index < 0 || index >= (row ? c.activeSheet.rowCount : c.activeSheet.columnCount)) return;
      target = row ? {kind: "row", sheetId: c.activeSheet.id, row: index} : {kind: "column", sheetId: c.activeSheet.id, column: index};
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
      const duplicateSheet = target.kind === "sheet" && c.features.duplicateSheet && !c.readOnly ?
        { disabled: c.disabled || workbook.sheets.length >= 100 } : null;
      const renameSheet = target.kind === "sheet" && c.features.renameSheet && !c.readOnly && onRenameSheet ?
        { disabled: c.disabled } : null;
      const actionSelection = selectionForContextTarget(context);
      const builtIns = target.kind === "sheet" ? [] : target.kind === "drawing" ? drawingMenuItems(c, target) : cellMenuItems(c, target, actionSelection);
      if (items.length || deleteSheet || duplicateSheet || renameSheet || builtIns.length) setMenu({ context, items, deleteSheet, duplicateSheet, renameSheet, actionSelection, builtIns, revision: c.getRevision(), x, y,
        returnFocus: target.kind === "drawing" ? element : root.current?.ownerDocument.activeElement as HTMLElement | null });
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
  const duplicateSheet = () => {
    if (!menu?.duplicateSheet || menu.duplicateSheet.disabled || menu.context.target.kind !== "sheet") return;
    const current = latest.current.c, sheetId = menu.context.target.sheetId;
    closeMenu();
    if (!current.features.duplicateSheet || current.readOnly || current.disabled || current.requesting || current.pendingObjectEdit) return;
    current.afterCommit(() => latest.current.c.afterCommand({ type: "sheets.duplicate", sheetId }, result => {
      const copied = result.results[0]?.sheetId;
      if (copied) latest.current.c.switchSheet(copied);
    }));
  };
  const renameSheet = () => {
    if (!menu?.renameSheet || menu.renameSheet.disabled || menu.context.target.kind !== "sheet") return;
    const captured = menu, current = latest.current.c, sheetId = captured.context.target.sheetId;
    closeMenu();
    if (!current.features.renameSheet || current.readOnly || current.disabled || current.requesting || current.pendingObjectEdit ||
      current.getRevision() !== captured.revision || !current.getWorkbook().sheets.some(sheet => sheet.id === sheetId)) return;
    latest.current.onRenameSheet?.(sheetId);
  };
  const selectDrawingBuiltin = (action: DrawingMenuAction) => {
    if (!menu || menu.context.target.kind !== "drawing") return;
    const captured = menu, target = menu.context.target, current = latest.current.c;
    const item = drawingMenuItems(current, target).find(item => item.id === action);
    closeMenu();
    const isCurrent = () => mounted.current && latest.current.c.getRevision() === captured.revision &&
      latest.current.c.getStructureRevision() === captured.context.structureRevision &&
      latest.current.c.activeSheet.id === target.sheetId && latest.current.c.selectedDrawingId === target.drawingId;
    if (!item || item.disabled || !isCurrent()) return;
    const drawing = current.getWorkbook().sheets.find(sheet => sheet.id === target.sheetId)?.drawings?.find(item => item.id === target.drawingId);
    if (!drawing) return;
    const execute = (command: SpreadsheetCommand, after?: (drawingId?: string) => void) => {
      void chainResult(current.executeCommands([command], { isCurrent }), result => {
        if (result.ok && mounted.current && latest.current.c.activeSheet.id === target.sheetId) after?.(result.results[0]?.drawingId);
      });
    };
    try {
      if (action === "drawing-copy") { void latest.current.clipboard.copy(); return; }
      if (action === "drawing-paste") { void latest.current.clipboard.paste(); return; }
      if (action === "drawing-duplicate") {
        const payload = copySpreadsheetDrawing(current.getWorkbook(), target.sheetId, drawing.id, { features: current.features });
        execute({ type: "drawings.paste", sheetId: target.sheetId, payload, anchor: { ...drawing.anchor, offsetX: Math.min(10_000, drawing.anchor.offsetX + 16), offsetY: Math.min(10_000, drawing.anchor.offsetY + 16) } }, id => { if (id) void latest.current.c.selectDrawing(id); }); return;
      }
      if (action === "drawing-delete") {
        execute({ type: "drawings.delete", sheetId: target.sheetId, drawingId: drawing.id }, () => { void latest.current.c.selectDrawing(null); latest.current.c.requestGridFocus(); }); return;
      }
      const type = drawing.type === "image" ? "images.update" : drawing.type === "shape" ? "shapes.update" : "textBoxes.update";
      const patch = action === "drawing-flip-x" ? { flipX: !drawing.flipX } : action === "drawing-flip-y" ? { flipY: !drawing.flipY } : { rotation: 0 };
      execute({ type, sheetId: target.sheetId, drawingId: drawing.id, patch });
    } catch (cause) { current.reportError(cause); }
  };
  const selectBuiltin = (action: CellMenuAction) => {
    if (!menu || menu.context.target.kind === "sheet" || menu.context.target.kind === "drawing") return;
    const captured = menu, target = captured.context.target, current = latest.current.c, selection = captured.actionSelection;
    if (target.kind === "sheet" || target.kind === "drawing") return;
    const item = cellMenuItems(current, target, selection).find(item => item.id === action);
    closeMenu();
    if (!item || item.disabled || current.getRevision() !== captured.revision || current.getStructureRevision() !== captured.context.structureRevision) return;
    const sheetId = target.sheetId;
    const execute = (commands: readonly SpreadsheetCommand[]) => void current.executeCommands(commands, {
      isCurrent: () => mounted.current && latest.current.c.getRevision() === captured.revision &&
        latest.current.c.getStructureRevision() === captured.context.structureRevision,
    });
    try {
      if (action === "copy" || action === "cut") { void latest.current.clipboard.copy(action === "cut", selection); return; }
      if (action === "paste" || action === "paste-values" || action === "paste-formats") {
        void latest.current.clipboard.paste(action === "paste-values" ? "values" : action === "paste-formats" ? "formats" : "all", selection); return;
      }
      if (action === "clear" || action === "delete-cells") {
        execute(selectionRanges(selection).map(range => ({type: "cells.clear", sheetId, range: rangeBounds(range), mode: action === "clear" ? "values" : "all"}))); return;
      }
      if (action === "insert-cells" || action === "shift-delete-cells") {
        setDialog({kind: action === "insert-cells" ? "insert-cells" : "delete-cells", axis: "row", sheetId, selection, revision: captured.revision}); return;
      }
      if (action === "format" || action === "resize") {
        setDialog({kind: action === "format" ? "format" : "dimension", axis: target.kind === "row" ? "row" : "column", sheetId, selection, revision: captured.revision}); return;
      }
      if (action === "autofit" && target.kind !== "cell") {
        const doc = root.current?.ownerDocument;
        if (doc) execute([autoFitCommand(current.getWorkbook(), sheetId, target.kind, selectionAxisIndices(selection, target.kind), doc, current.getWorkbook() === current.workbook ? current.calculated[sheetId] : undefined, root.current ?? undefined)]); return;
      }
      if ((action === "comment" || action === "delete-comment") && target.kind === "cell") {
        if (action === "delete-comment") execute([{type: "comments.set", sheetId, address: target.address, comment: null}]);
        else { current.selectCellInSheet(sheetId, target); current.setCommentOpen(true); }
        return;
      }
      if (action === "insert-rows" || action === "delete-rows" || action === "insert-columns" || action === "delete-columns")
        execute(contextStructureCommands(sheetId, selection, action.endsWith("rows") ? "row" : "column", action.startsWith("insert")));
    } catch (cause) { current.reportError(cause); }
  };
  const visibleMenu = menu?.context.target.kind === "sheet" ? (c.features.sheets ? menu : null) : menu;
  return { menu: visibleMenu, state, closeMenu, selectItem,
    selectBuiltin: (action: CellMenuAction | DrawingMenuAction) => action.startsWith("drawing-") ? selectDrawingBuiltin(action as DrawingMenuAction) : selectBuiltin(action as CellMenuAction),
    deleteSheet, duplicateSheet, renameSheet, spreadsheet: c,
    dialog: c.readOnly ? null : dialog, closeDialog: () => { c.cancelEditRequest(); setDialog(null); },
    cancel: () => executorRef.current?.cancel(), confirm: () => { void executorRef.current?.confirm(); },
    onContextMenu, onPointerDownCapture, onKeyDownCapture };
}

export type SpreadsheetContextMenuController = ReturnType<typeof useSpreadsheetContextMenu>;
