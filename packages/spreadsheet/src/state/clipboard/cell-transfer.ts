import { cellAddress, formatCells, getMergedRange, mergeCells, moveCells, parseTsv, rangeContains, rangesIntersect, setCellComments, setCellValues, SPREADSHEET_LIMITS, stringifyTsv, translateFormula, unmergeCells } from "../../model";
import type { SpreadsheetCellFormat, SpreadsheetCalculatedValue, SpreadsheetComment, SpreadsheetMergedRange, SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";
import type { SpreadsheetFeatures, SpreadsheetSelection } from "../../props";
import { isMultiRangeSelection, MAX_SELECTION_CELLS, selectionBounds } from "../selection";

/** Transfer rules depend on workbook snapshots and feature policy, never browser APIs or a React controller. */
export type CellTransferContext = {
  workbook: SpreadsheetWorkbook;
  activeSheet: SpreadsheetSheet;
  selection: SpreadsheetSelection;
  calculated: Readonly<Record<string, Readonly<Record<string, SpreadsheetCalculatedValue>>>>;
  features: Required<Pick<SpreadsheetFeatures, "mergeCells" | "formulas" | "formatting" | "comments">>;
};
export type CopiedCells = {
  token: string; text: string; values: string[][]; formats: (SpreadsheetCellFormat | undefined)[][];
  comments: (SpreadsheetComment | undefined)[][]; merges: SpreadsheetMergedRange[];
  sheetId: string; top: number; left: number; cut: boolean; workbook: SpreadsheetWorkbook;
};

export const SINGLE_RANGE_CLIPBOARD_MESSAGE = "コピー・切り取り・貼り付けは、1つの連続した範囲を選択してください";
const PARTIAL_MERGE_CLIPBOARD_MESSAGE = "結合されたセルの一部には貼り付けできません。結合を解除するか、結合全体を選択してください";

export function assertSingleClipboardRange(selection: SpreadsheetSelection): void {
  if (isMultiRangeSelection(selection)) throw new Error(SINGLE_RANGE_CLIPBOARD_MESSAGE);
}

export function captureCopiedCells(context: CellTransferContext, cut: boolean): Omit<CopiedCells, "token"> {
  assertSingleClipboardRange(context.selection);
  const bounds = selectionBounds(context.selection);
  const merges = (context.activeSheet.merges ?? []).filter(merge => rangesIntersect(bounds, merge));
  if (merges.some(merge => !rangeContains(bounds, merge))) throw new Error("結合されたセルの一部はコピー・切り取りできません。結合全体を選択してください");
  if (cut && merges.length && !context.features.mergeCells) throw new Error("セルの結合の変更は無効です");
  if ((bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1) > MAX_SELECTION_CELLS) throw new Error("コピーできる範囲は 10,000 セルまでです");
  const values: string[][] = [], displayed: string[][] = [], formats: (SpreadsheetCellFormat | undefined)[][] = [];
  const comments: (SpreadsheetComment | undefined)[][] = [];
  for (let row = bounds.top; row <= bounds.bottom; row++) {
    const raw: string[] = [], rendered: string[] = [], rowFormats: (SpreadsheetCellFormat | undefined)[] = [];
    const rowComments: (SpreadsheetComment | undefined)[] = [];
    for (let column = bounds.left; column <= bounds.right; column++) {
      const address = cellAddress(row, column);
      raw.push(context.activeSheet.cells[address]?.value ?? "");
      const format = context.activeSheet.cells[address]?.format;
      rowFormats.push(format ? { ...format } : undefined);
      rowComments.push(context.features.comments ? context.activeSheet.comments?.[address] : undefined);
      rendered.push(String(context.calculated[context.activeSheet.id]?.[address] ?? ""));
    }
    values.push(raw); displayed.push(rendered); formats.push(rowFormats);
    comments.push(rowComments);
  }
  const text = stringifyTsv(displayed);
  return { text, values, formats, comments, merges: merges.map(merge => ({ ...merge })), sheetId: context.activeSheet.id, top: bounds.top, left: bounds.left, cut, workbook: context.workbook };
}

/** Preflight geometry and return one atomic workbook operation. Identity creation belongs to the caller. */
export function prepareCellPaste(context: CellTransferContext, text: string, internal: CopiedCells | null) {
  assertSingleClipboardRange(context.selection);
  if (text.length > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("貼り付けるテキストが上限を超えています");
  const values = internal?.values ?? parseTsv(text);
  let { top, left } = selectionBounds(context.selection);
  const width = Math.max(0, ...values.map(row => row.length));
  if (!values.length || !width) return;
  if (values.length * width > MAX_SELECTION_CELLS) throw new Error("一度に貼り付けできる範囲は 10,000 セルまでです");
  if (top + values.length > context.activeSheet.rowCount || left + width > context.activeSheet.columnCount)
    throw new Error("貼り付け先の行・列が足りません。先に行や列を追加してください");
  const scalarMerge = values.length === 1 && width === 1 && (!internal || (!internal.cut && !internal.merges.length))
    ? getMergedRange(context.activeSheet, { row: top, column: left }) : undefined;
  if (scalarMerge) { top = scalarMerge.top; left = scalarMerge.left; }
  const destination = { top, left, bottom: top + values.length - 1, right: left + width - 1 };
  const destinationMerges = (context.activeSheet.merges ?? []).filter(merge => rangesIntersect(destination, merge));
  if (!scalarMerge) {
    // A cut removes its own source merges first, including when the destination overlaps them.
    const source = internal?.cut && internal.sheetId === context.activeSheet.id
      ? { top: internal.top, left: internal.left, bottom: internal.top + values.length - 1, right: internal.left + width - 1 } : null;
    if (destinationMerges.some(merge => !rangeContains(destination, merge) && !(source && rangeContains(source, merge))))
      throw new Error(PARTIAL_MERGE_CLIPBOARD_MESSAGE);
    if (!internal && destinationMerges.length) throw new Error("結合されたセルを含む範囲への貼り付けには、先に結合を解除してください");
    if (internal && !context.features.mergeCells && (internal.merges.length || destinationMerges.length))
      throw new Error("セルの結合の変更は無効です");
  }
  const updates: Record<string, string> = {};
  for (let row = 0; row < values.length; row++) for (let column = 0; column < width; column++) {
    const value = values[row]?.[column] ?? "";
    updates[cellAddress(top + row, left + column)] = internal && value.startsWith("=") && !internal.cut
      ? translateFormula(value, top - internal.top, left - internal.left) : value;
  }
  const applyTo = (current: SpreadsheetWorkbook, nextCommentId: () => string) => {
    if (!context.features.formulas && Object.values(updates).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
    if (internal?.cut && internal.workbook === current) {
      return moveCells(current, { sheetId: internal.sheetId, top: internal.top, left: internal.left, bottom: internal.top + values.length - 1, right: internal.left + width - 1 }, { sheetId: context.activeSheet.id, row: top, column: left });
    }
    let next = internal && !scalarMerge && destinationMerges.length ? unmergeCells(current, context.activeSheet.id, destination) : current;
    next = setCellValues(next, context.activeSheet.id, updates);
    if (internal && context.features.formatting) {
      const groups = new Map<string, { addresses: string[]; format: SpreadsheetCellFormat | undefined }>();
      internal.formats.forEach((row, r) => row.forEach((format, column) => {
        const key = JSON.stringify(format ?? {}), group = groups.get(key) ?? { addresses: [], format };
        group.addresses.push(cellAddress(top + r, left + column)); groups.set(key, group);
      }));
      for (const { addresses, format } of groups.values()) next = formatCells(next, context.activeSheet.id, addresses,
        { bold: undefined, italic: undefined, underline: undefined, align: undefined, color: undefined, background: undefined, numberFormat: undefined, ...format });
    }
    if (internal && context.features.comments) {
      const comments: Record<string, SpreadsheetComment | null> = {};
      internal.comments.forEach((row, r) => row.forEach((comment, column) => {
        comments[cellAddress(top + r, left + column)] = comment ? { ...comment, id: nextCommentId() } : null;
      }));
      next = setCellComments(next, context.activeSheet.id, comments);
    }
    if (internal) for (const merge of internal.merges) next = mergeCells(next, context.activeSheet.id, {
      top: top + merge.top - internal.top, left: left + merge.left - internal.left,
      bottom: top + merge.bottom - internal.top, right: left + merge.right - internal.left,
    });
    return next;
  };
  return { destination, applyTo };
}
