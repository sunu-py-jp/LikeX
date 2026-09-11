"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ClipboardEvent } from "react";
import type { SpreadsheetController } from "./use-spreadsheet";
import { chainResult } from "../core";
import { createSelection, isMultiRangeSelection, selectionRanges } from "./selection";
import { assertSingleClipboardRange, captureCopiedCells, cellPasteFocus, prepareCellPaste, type CopiedCells } from "./clipboard/cell-transfer";
import { CLIPBOARD_MIME_TYPE, clipboardTextMatches, clipboardTokenFromHtml, isOtherTextControl, readBrowserClipboard, spreadsheetClipboardHtml, writeBrowserClipboard } from "./clipboard/browser-clipboard";
import { captureCopiedDrawing, prepareDrawingPaste, type CopiedDrawing } from "./clipboard/drawing-transfer";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetPasteMode } from "../api/editing-commands";

export function useSpreadsheetClipboard(controller: SpreadsheetController) {
  const latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; });
  const mounted = useRef(true);
  const requestId = useRef(0);
  const latestPaste = useRef<(text: string, token?: string, mode?: SpreadsheetPasteMode, selection?: SpreadsheetSelection) => void>(() => {});
  const cancelPending = useCallback(() => { requestId.current++; }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelPending(); }; }, [cancelPending]);
  const copied = useRef<(CopiedCells & { kind: "cells" }) | CopiedDrawing | null>(null);
  const copyGeneration = useRef(0);
  useLayoutEffect(() => {
    // A rejected multi-range operation must not leave a previous cut armed.
    if (isMultiRangeSelection(controller.selection) && copied.current?.kind !== "drawing") { copied.current = null; copyGeneration.current++; }
  }, [controller.selection]);
  useLayoutEffect(() => {
    // Policy revocation also invalidates clipboard writes that have not armed a cut yet.
    requestId.current++;
    copyGeneration.current++;
    if (copied.current?.kind === "cells" && copied.current.cut && (!controller.features.cut || !controller.features.paste || controller.readOnly)) {
      copied.current = null;
    }
  }, [controller.features.copy, controller.features.cut, controller.features.paste, controller.features.pasteSpecial, controller.features.images, controller.features.shapes, controller.features.textBoxes, controller.readOnly]);
  const emitClipboard = (action: "copy" | "cut" | "paste", drawingId?: string, selection = controller.selection) => controller.emitEvent({
    type: "clipboard", action, sheetId: selection.sheetId, ...(drawingId ? { drawingId } : {}),
    selection: createSelection(selection.sheetId, selectionRanges(selection), selection.focus),
  });
  const requireSingleRange = (selection: SpreadsheetController["selection"]) => {
    if (!isMultiRangeSelection(selection)) return;
    copied.current = null;
    assertSingleClipboardRange(selection);
  };
  const targetContext = (selection?: SpreadsheetSelection) => {
    if (!selection) return controller;
    const activeSheet = controller.getWorkbook().sheets.find(sheet => sheet.id === selection.sheetId);
    if (!activeSheet || activeSheet.id !== controller.activeSheet.id) throw new Error("貼り付け先のシートが変わりました");
    return { ...controller, selection, activeSheet, selectedDrawingId: null, selectedDrawing: undefined };
  };
  const prepare = (cut: boolean, selection?: SpreadsheetSelection) => {
    if (!(cut ? controller.features.cut : controller.features.copy) || (cut && controller.disabled) || controller.pendingObjectEdit) return null;
    if (!selection && controller.selectedDrawingId) return cut ? null : captureCopiedDrawing(controller);
    const context = targetContext(selection);
    requireSingleRange(context.selection);
    const snapshot = captureCopiedCells(context, cut);
    return { ...snapshot, kind: "cells" as const, token: crypto.randomUUID() };
  };
  const pasteText = (text: string, token = "", mode: SpreadsheetPasteMode = "all", selection?: SpreadsheetSelection) => {
    if (controller.disabled || controller.pendingObjectEdit || !controller.features.paste || (mode !== "all" && !controller.features.pasteSpecial)) return;
    try {
      const context = targetContext(selection);
      const matched = token && copied.current?.token === token && clipboardTextMatches(copied.current.text, text) ? copied.current : null;
      const request = requestId.current;
      const isCurrent = () => mounted.current && request === requestId.current && latest.current.features.paste &&
        (mode === "all" || latest.current.features.pasteSpecial) && latest.current.selection === controller.selection &&
        latest.current.selectedDrawingId === controller.selectedDrawingId && !latest.current.editing && !latest.current.pendingObjectEdit;
      if (matched?.kind === "drawing") {
        if (mode !== "all") throw new Error("図形には通常の貼り付けを使用してください");
        const command = prepareDrawingPaste(context, matched, selection);
        void chainResult(controller.executeCommands([command], { isCurrent }), accepted => {
          if (!accepted.ok || !mounted.current) return;
          const drawingId = accepted.results[0].drawingId;
          if (drawingId) { void latest.current.selectDrawing(drawingId); emitClipboard("paste", drawingId, context.selection); }
        });
        return;
      }
      if (context.selectedDrawingId) return;
      requireSingleRange(context.selection);
      // An intervening edit invalidates a pending cut; never clear a newer source.
      const internal = matched?.cut && matched.workbook !== controller.getWorkbook() ? null : matched;
      const paste = prepareCellPaste(context, text, internal, mode);
      if (!paste) return;
      void chainResult(controller.executeCommands(paste.commands, {
        isCurrent: () => isCurrent() && (!internal?.cut || (latest.current.features.cut && copied.current === internal)),
      }), accepted => {
        if (accepted.ok && mounted.current) {
          const { top, left, bottom, right } = paste.destination;
          controller.selectRangeInSheet(context.activeSheet.id, { row: top, column: left }, { row: bottom, column: right },
            cellPasteFocus(paste.destination, context.selection.focus), paste.axis);
          if (internal?.cut) copied.current = null;
          emitClipboard("paste", undefined, context.selection);
        }
      });
    } catch (cause) { controller.reportError(cause); }
  };
  const onCopy = (event: ClipboardEvent, cut = false) => {
    if (isOtherTextControl(event.target) || controller.editing) return;
    event.preventDefault();
    if (!(cut ? controller.features.cut : controller.features.copy)) return;
    requestId.current++;
    try {
      const value = prepare(cut);
      if (value) {
        event.clipboardData.setData("text/plain", value.text);
        event.clipboardData.setData(CLIPBOARD_MIME_TYPE, value.token);
        event.clipboardData.setData("text/html", spreadsheetClipboardHtml(value));
        copied.current = value;
        emitClipboard(cut ? "cut" : "copy", value.kind === "drawing" ? value.payload.drawing.id : undefined);
      }
    } catch (cause) { controller.reportError(cause); }
  };
  const copy = async (cut = false, selection?: SpreadsheetSelection) => {
    const request = ++requestId.current;
    const generation = copyGeneration.current;
    try {
      const value = prepare(cut, selection);
      if (!value) return;
      if (await writeBrowserClipboard(value)) {
        const current = latest.current;
        if (mounted.current && request === requestId.current && (cut ? current.features.cut : current.features.copy) && current.selectedDrawingId === controller.selectedDrawingId &&
          generation === copyGeneration.current && (value.kind === "drawing" || !isMultiRangeSelection(selection ?? current.selection)) &&
          (!cut || (!current.disabled && current.workbook === controller.workbook))) { copied.current = value; emitClipboard(cut ? "cut" : "copy", value.kind === "drawing" ? value.payload.drawing.id : undefined, selection ?? controller.selection); }
      } else {
        if (mounted.current && request === requestId.current) {
          copied.current = null;
          if (cut || value.kind === "drawing") latest.current.reportError(new Error("このブラウザでは文字だけをコピーしました。図形のコピー・切り取りにはキーボードショートカットを使用してください"));
        }
      }
    } catch (cause) { if (mounted.current && request === requestId.current) latest.current.reportError(cause); }
  };
  const paste = async (mode: SpreadsheetPasteMode = "all", selection?: SpreadsheetSelection) => {
    if (controller.disabled || !controller.features.paste || (mode !== "all" && !controller.features.pasteSpecial) || controller.pendingObjectEdit) return;
    const request = ++requestId.current;
    try {
      if (copied.current?.kind !== "drawing" && !(selection ? false : controller.selectedDrawingId)) requireSingleRange(selection ?? controller.selection);
      const { text, token, hasText } = await readBrowserClipboard();
      const current = latest.current;
      if (!mounted.current || request !== requestId.current || !hasText || current.editing || current.disabled || !current.features.paste || (mode !== "all" && !current.features.pasteSpecial) || current.pendingObjectEdit) return;
      if (copied.current?.kind !== "drawing" && !(selection ? false : current.selectedDrawingId)) requireSingleRange(selection ?? current.selection);
      if (current.workbook !== controller.workbook || current.selection !== controller.selection || current.selectedDrawingId !== controller.selectedDrawingId) return;
      latestPaste.current(text, token, mode, selection);
    } catch (cause) { if (mounted.current && request === requestId.current) latest.current.reportError(cause); }
  };
  useLayoutEffect(() => { latestPaste.current = pasteText; });
  return { copy, paste, onCopy, onCut: (event: ClipboardEvent) => onCopy(event, true), onPaste: (event: ClipboardEvent) => {
    if (isOtherTextControl(event.target) || controller.editing) return;
    if (!controller.features.paste) { event.preventDefault(); return; }
    if (event.clipboardData.types && !Array.from(event.clipboardData.types).includes("text/plain")) return;
    requestId.current++;
    event.preventDefault(); pasteText(event.clipboardData.getData("text/plain"), event.clipboardData.getData(CLIPBOARD_MIME_TYPE) || clipboardTokenFromHtml(event.clipboardData.getData("text/html")));
  } };
}
