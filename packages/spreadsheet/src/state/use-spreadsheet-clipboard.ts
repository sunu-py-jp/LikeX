"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ClipboardEvent } from "react";
import { cellAddress, formatCells, moveCells, parseTsv, setCellValues, SPREADSHEET_LIMITS, stringifyTsv, translateFormula } from "../model";
import { MAX_SELECTION_CELLS, selectionBounds, type SpreadsheetController, type Workbook, type CellFormat } from "./use-spreadsheet";

function isOtherTextControl(target: EventTarget | null) {
  const control = (target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
  return !!control && !control.classList.contains("lxs-cell-input");
}

export function useSpreadsheetClipboard(controller: SpreadsheetController) {
  const latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; });
  const mounted = useRef(true);
  const requestId = useRef(0);
  const latestPaste = useRef<(text: string, token?: string) => void>(() => {});
  const cancelPending = useCallback(() => { requestId.current++; }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelPending(); }; }, [cancelPending]);
  const copied = useRef<{ token: string; text: string; values: string[][]; formats: (CellFormat | undefined)[][]; sheetId: string; top: number; left: number; cut: boolean; workbook: Workbook } | null>(null);
  const clipboardType = "application/x-likex-spreadsheet";
  const htmlToken = (html: string) => /data-likex-spreadsheet="([a-zA-Z0-9-]+)"/.exec(html)?.[1] ?? "";
  const prepare = (cut: boolean) => {
    if (!controller.features.clipboard || (cut && controller.disabled)) return null;
    const bounds = selectionBounds(controller.selection);
    if ((bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1) > MAX_SELECTION_CELLS) throw new Error("コピーできる範囲は 10,000 セルまでです");
    const values: string[][] = [], displayed: string[][] = [], formats: (CellFormat | undefined)[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      const raw: string[] = [], rendered: string[] = [], rowFormats: (CellFormat | undefined)[] = [];
      for (let column = bounds.left; column <= bounds.right; column++) {
        const address = cellAddress(row, column);
        raw.push(controller.activeSheet.cells[address]?.value ?? "");
        const format = controller.activeSheet.cells[address]?.format;
        rowFormats.push(format ? { ...format } : undefined);
        rendered.push(String(controller.calculated[controller.activeSheet.id]?.[address] ?? ""));
      }
      values.push(raw); displayed.push(rendered); formats.push(rowFormats);
    }
    const text = stringifyTsv(displayed);
    return { token: crypto.randomUUID(), text, values, formats, sheetId: controller.activeSheet.id, top: bounds.top, left: bounds.left, cut, workbook: controller.workbook };
  };
  const pasteText = (text: string, token = "") => {
    if (controller.disabled || !controller.features.clipboard) return;
    try {
      if (text.length > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("貼り付けるテキストが上限を超えています");
      const matched = token && copied.current?.token === token && copied.current.text === text ? copied.current : null;
      // An intervening edit invalidates a pending cut; never clear a newer source.
      const internal = matched?.cut && matched.workbook !== controller.workbook ? null : matched;
      const values = internal?.values ?? parseTsv(text);
      const { top, left } = selectionBounds(controller.selection);
      const width = Math.max(0, ...values.map(row => row.length));
      if (!values.length || !width) return;
      if (values.length * width > MAX_SELECTION_CELLS) throw new Error("一度に貼り付けできる範囲は 10,000 セルまでです");
      if (top + values.length > controller.activeSheet.rowCount || left + width > controller.activeSheet.columnCount)
        throw new Error("貼り付け先の行・列が足りません。先に行や列を追加してください");
      const updates: Record<string, string> = {};
      for (let row = 0; row < values.length; row++) for (let column = 0; column < width; column++) {
        const value = values[row]?.[column] ?? "";
        updates[cellAddress(top + row, left + column)] = internal && value.startsWith("=") && !internal.cut
          ? translateFormula(value, top - internal.top, left - internal.left) : value;
      }
      const accepted = controller.apply(current => {
        if (!controller.features.formulas && Object.values(updates).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
        if (internal?.cut && internal.workbook === current) {
          return moveCells(current, { sheetId: internal.sheetId, top: internal.top, left: internal.left, bottom: internal.top + values.length - 1, right: internal.left + width - 1 }, { sheetId: controller.activeSheet.id, row: top, column: left });
        }
        let next = setCellValues(current, controller.activeSheet.id, updates);
        if (internal && controller.features.formatting) {
          const groups = new Map<string, { addresses: string[]; format: CellFormat | undefined }>();
          internal.formats.forEach((row, r) => row.forEach((format, column) => {
            const key = JSON.stringify(format ?? {}), group = groups.get(key) ?? { addresses: [], format };
            group.addresses.push(cellAddress(top + r, left + column)); groups.set(key, group);
          }));
          for (const { addresses, format } of groups.values()) next = formatCells(next, controller.activeSheet.id, addresses,
            { bold: undefined, italic: undefined, underline: undefined, align: undefined, color: undefined, background: undefined, numberFormat: undefined, ...format });
        }
        return next;
      });
      if (accepted) {
        controller.selectRange({ row: top, column: left }, { row: top + values.length - 1, column: left + width - 1 });
        if (internal?.cut) copied.current = null;
      }
    } catch (cause) { controller.reportError(cause); }
  };
  const onCopy = (event: ClipboardEvent, cut = false) => {
    if (isOtherTextControl(event.target) || controller.editing) return;
    event.preventDefault();
    if (!controller.features.clipboard) return;
    requestId.current++;
    try {
      const value = prepare(cut);
      if (value) {
        event.clipboardData.setData("text/plain", value.text);
        event.clipboardData.setData(clipboardType, value.token);
        copied.current = value;
      }
    } catch (cause) { controller.reportError(cause); }
  };
  const copy = async (cut = false) => {
    requestId.current++;
    try {
      const value = prepare(cut);
      if (!value) return;
      if (!navigator.clipboard?.writeText) throw new Error("このブラウザではコピーのショートカットを使用してください");
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
        const rows = parseTsv(value.text).map(row => `<tr>${row.map(text => `<td>${escape(text)}</td>`).join("")}</tr>`).join("");
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([value.text], { type: "text/plain" }), "text/html": new Blob([`<table data-likex-spreadsheet="${value.token}"><tbody>${rows}</tbody></table>`], { type: "text/html" }) })]);
        copied.current = value;
      } else {
        await navigator.clipboard.writeText(value.text);
        copied.current = null;
        if (cut) controller.reportError(new Error("このブラウザでは値のみコピーしました。切り取りにはキーボードショートカットを使用してください"));
      }
    } catch (cause) { controller.reportError(cause); }
  };
  const paste = async () => {
    if (controller.disabled || !controller.features.clipboard) return;
    const request = ++requestId.current;
    try {
      if (!navigator.clipboard?.readText) throw new Error("このブラウザでは貼り付けのショートカットを使用してください");
      let text = "", token = "", hasText = false;
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/plain")) { text = await (await item.getType("text/plain")).text(); hasText = true; }
          if (item.types.includes("text/html")) token = htmlToken(await (await item.getType("text/html")).text());
        }
      } else { text = await navigator.clipboard.readText(); hasText = true; }
      const current = latest.current;
      if (!mounted.current || request !== requestId.current || !hasText || current.editing || current.disabled || !current.features.clipboard || current.workbook !== controller.workbook || current.selection !== controller.selection) return;
      latestPaste.current(text, token);
    } catch (cause) { if (mounted.current && request === requestId.current) latest.current.reportError(cause); }
  };
  useLayoutEffect(() => { latestPaste.current = pasteText; });
  return { copy, paste, onCopy, onCut: (event: ClipboardEvent) => onCopy(event, true), onPaste: (event: ClipboardEvent) => {
    if (isOtherTextControl(event.target) || controller.editing) return;
    if (!controller.features.clipboard) { event.preventDefault(); return; }
    if (event.clipboardData.types && !Array.from(event.clipboardData.types).includes("text/plain")) return;
    requestId.current++;
    event.preventDefault(); pasteText(event.clipboardData.getData("text/plain"), event.clipboardData.getData(clipboardType) || htmlToken(event.clipboardData.getData("text/html")));
  } };
}
