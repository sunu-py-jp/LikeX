"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ClipboardEvent } from "react";
import type { SpreadsheetController } from "./use-spreadsheet";
import { chainResult } from "../core";
import { createSelection, isMultiRangeSelection, selectionRanges } from "./selection";
import { assertSingleClipboardRange, captureCopiedCells, prepareCellPaste, SINGLE_RANGE_CLIPBOARD_MESSAGE, type CopiedCells } from "./clipboard/cell-transfer";
import { CLIPBOARD_MIME_TYPE, clipboardTokenFromHtml, isOtherTextControl, readBrowserClipboard, writeBrowserClipboard } from "./clipboard/browser-clipboard";

export function useSpreadsheetClipboard(controller: SpreadsheetController) {
  const latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; });
  const mounted = useRef(true);
  const requestId = useRef(0);
  const latestPaste = useRef<(text: string, token?: string) => void>(() => {});
  const cancelPending = useCallback(() => { requestId.current++; }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelPending(); }; }, [cancelPending]);
  const copied = useRef<CopiedCells | null>(null);
  const copyGeneration = useRef(0);
  useLayoutEffect(() => {
    // A rejected multi-range operation must not leave a previous cut armed.
    if (isMultiRangeSelection(controller.selection)) { copied.current = null; copyGeneration.current++; }
  }, [controller.selection]);
  useLayoutEffect(() => {
    // Policy revocation also invalidates clipboard writes that have not armed a cut yet.
    requestId.current++;
    copyGeneration.current++;
    if (copied.current?.cut && (!controller.features.cut || !controller.features.paste || controller.readOnly)) {
      copied.current = null;
    }
  }, [controller.features.copy, controller.features.cut, controller.features.paste, controller.readOnly]);
  const emitClipboard = (action: "copy" | "cut" | "paste") => controller.emitEvent({
    type: "clipboard", action, sheetId: controller.activeSheet.id,
    selection: createSelection(controller.selection.sheetId, selectionRanges(controller.selection), controller.selection.focus),
  });
  const requireSingleRange = (selection: SpreadsheetController["selection"]) => {
    if (!isMultiRangeSelection(selection)) return;
    copied.current = null;
    assertSingleClipboardRange(selection);
  };
  const prepare = (cut: boolean) => {
    if (!(cut ? controller.features.cut : controller.features.copy) || controller.selectedDrawingId || (cut && controller.disabled)) return null;
    requireSingleRange(controller.selection);
    const snapshot = captureCopiedCells(controller, cut);
    return { ...snapshot, token: crypto.randomUUID() };
  };
  const pasteText = (text: string, token = "") => {
    if (controller.disabled || !controller.features.paste || controller.selectedDrawingId) return;
    try {
      requireSingleRange(controller.selection);
      const matched = token && copied.current?.token === token && copied.current.text === text ? copied.current : null;
      // An intervening edit invalidates a pending cut; never clear a newer source.
      const internal = matched?.cut && matched.workbook !== controller.getWorkbook() ? null : matched;
      const paste = prepareCellPaste(controller, text, internal);
      if (!paste) return;
      const request = requestId.current;
      void chainResult(controller.apply(current => {
        // Permissions can resolve after feature settings change. Rebuild from live rules.
        const prepared = prepareCellPaste({ ...latest.current, workbook: current }, text, internal);
        return prepared ? prepared.applyTo(current, () => crypto.randomUUID()) : current;
      }, { source: "ui", action: "paste", sheetId: controller.activeSheet.id,
        isCurrent: () => mounted.current && request === requestId.current && latest.current.features.paste &&
          (!internal?.cut || (latest.current.features.cut && copied.current === internal)) &&
          latest.current.selection === controller.selection && !latest.current.editing && !latest.current.selectedDrawingId,
      }), accepted => {
        if (accepted && mounted.current) {
          const { top, left, bottom, right } = paste.destination;
          controller.selectRange({ row: top, column: left }, { row: bottom, column: right });
          if (internal?.cut) copied.current = null;
          emitClipboard("paste");
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
        copied.current = value;
        emitClipboard(cut ? "cut" : "copy");
      }
    } catch (cause) { controller.reportError(cause); }
  };
  const copy = async (cut = false) => {
    const request = ++requestId.current;
    const generation = copyGeneration.current;
    try {
      const value = prepare(cut);
      if (!value) return;
      if (await writeBrowserClipboard(value)) {
        const current = latest.current;
        if (mounted.current && request === requestId.current && (cut ? current.features.cut : current.features.copy) && !current.selectedDrawingId &&
          generation === copyGeneration.current && !isMultiRangeSelection(current.selection) &&
          (!cut || (!current.disabled && current.workbook === controller.workbook))) { copied.current = value; emitClipboard(cut ? "cut" : "copy"); }
      } else {
        if (mounted.current && request === requestId.current) {
          copied.current = null;
          if (cut) latest.current.reportError(new Error("このブラウザでは値のみコピーしました。切り取りにはキーボードショートカットを使用してください"));
        }
      }
    } catch (cause) { if (mounted.current && request === requestId.current) latest.current.reportError(cause); }
  };
  const paste = async () => {
    if (controller.disabled || !controller.features.paste || controller.selectedDrawingId) return;
    const request = ++requestId.current;
    try {
      requireSingleRange(controller.selection);
      const { text, token, hasText } = await readBrowserClipboard();
      const current = latest.current;
      if (!mounted.current || request !== requestId.current || !hasText || current.editing || current.disabled || !current.features.paste || current.selectedDrawingId) return;
      requireSingleRange(current.selection);
      if (current.workbook !== controller.workbook || current.selection !== controller.selection) return;
      latestPaste.current(text, token);
    } catch (cause) { if (mounted.current && request === requestId.current) latest.current.reportError(cause); }
  };
  useLayoutEffect(() => { latestPaste.current = pasteText; });
  return { copy, paste, onCopy, onCut: (event: ClipboardEvent) => onCopy(event, true), onPaste: (event: ClipboardEvent) => {
    if (isOtherTextControl(event.target) || controller.editing) return;
    if (!controller.features.paste || controller.selectedDrawingId) { event.preventDefault(); return; }
    if (isMultiRangeSelection(controller.selection)) {
      event.preventDefault(); requestId.current++; copied.current = null;
      controller.reportError(new Error(SINGLE_RANGE_CLIPBOARD_MESSAGE)); return;
    }
    if (event.clipboardData.types && !Array.from(event.clipboardData.types).includes("text/plain")) return;
    requestId.current++;
    event.preventDefault(); pasteText(event.clipboardData.getData("text/plain"), event.clipboardData.getData(CLIPBOARD_MIME_TYPE) || clipboardTokenFromHtml(event.clipboardData.getData("text/html")));
  } };
}
