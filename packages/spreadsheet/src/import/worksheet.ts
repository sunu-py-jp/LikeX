import { cellAddress, parseCellAddress } from "../model/address";
import { parseFormula, rewriteFormulaReferences, translateFormula } from "../model/formula";
import { SUPPORTED_SPREADSHEET_FUNCTIONS } from "../model/function-definitions";
import { DEFAULT_SHEET_SIZE } from "../model/sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetMergedRange, type SpreadsheetSheet } from "../model/types";
import { XLSX_IMPORT_LIMITS, type ImportContext } from "./types";
import { child, children, localName, spreadsheetText, textContent, type XmlNode } from "./xml";
import { worksheetDefaultSizes } from "./worksheet-shared";
import { excelCellAddress, readExcelCellAddress } from "./worksheet-address";
import { normalizeMerges, rangesIntersect } from "../model/merges";
import { indexMerges, type SpreadsheetMergeIndex } from "../model/merge-index";
import { xlsxColumnWidthToPixels } from "../xlsx-column-width";

const functions = new Set<string>(SUPPORTED_SPREADSHEET_FUNCTIONS.map(item => item.name));
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const excelErrors = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!", "#CONNECT!", "#BLOCKED!", "#UNKNOWN!", "#FIELD!", "#BUSY!", "#PYTHON!"]);
const fail = (message: string): never => { throw new Error(`Excelのワークシートを読み込めません: ${message}`); };
export function importRange(value: string): SpreadsheetMergedRange {
  if (!/^\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?$/i.test(value)) return fail("範囲のセル番地が不正です");
  const parts = value.split(":"), start = parseCellAddress(parts[0]), end = parseCellAddress(parts[1] ?? parts[0]);
  if (parts.length > 2 || !start || !end || start.row > end.row || start.column > end.column || end.row >= SPREADSHEET_LIMITS.rows || end.column >= SPREADSHEET_LIMITS.columns) return fail("範囲が不正、または10,000行・1,000列の上限を超えています");
  return { top: start.row, left: start.column, bottom: end.row, right: end.column };
}
/** Shared-formula refs describe the source group, not stored cells or the model canvas. */
function sharedFormulaRange(value: string): SpreadsheetMergedRange {
  const parts = value.split(":"), start = readExcelCellAddress(parts[0]), end = readExcelCellAddress(parts[1] ?? parts[0]);
  if (parts.length > 2 || !start || !end || start.row > end.row || start.column > end.column)
    return fail("共有数式の参照範囲が不正です");
  return { top: start.row, left: start.column, bottom: end.row, right: end.column };
}
/** Rich text runs are flattened without including phonetic annotations. */
export function richText(node: XmlNode | undefined): string {
  return spreadsheetText(node?.children.filter(item => ["t", "r"].includes(localName(item.name))).map(item => localName(item.name) === "t" ? textContent(item) : textContent(child(item, "t"))).join("") ?? "");
}
function supportedFormula(value: string): boolean {
  try {
    const visit = (node: ReturnType<typeof parseFormula>): boolean => {
      switch (node.type) {
        case "call": return functions.has(node.name) && node.args.every(visit);
        case "unary": return visit(node.value);
        case "binary": return visit(node.left) && visit(node.right);
        case "error": return node.code !== "#NAME?";
        case "reference": return !/[\[\]\\]/.test(node.reference.sheet ?? "");
        case "range": return !/[\[\]\\]/.test(`${node.first.sheet ?? ""}${node.last.sheet ?? ""}`);
        default: return true;
      }
    };
    return visit(parseFormula(value));
  } catch { return false; }
}
function importFormula(value: string, context: ImportContext): string {
  const formula = `=${value.replace(/"(?:""|[^"])*"|_xlfn\.|_xlws\./gi, token => token.startsWith('"') ? token : "").replace(/^=/, "")}`;
  try {
    return rewriteFormulaReferences(formula, reference => {
      const target = reference.sheet && context.sheetNames?.get(reference.sheet.toLocaleLowerCase("en-US"));
      return target && target !== reference.sheet ? `'${target.replaceAll("'", "''")}'!${reference.address}` : undefined;
    });
  } catch { return formula; }
}
export function readWorksheetCellValue(node: XmlNode, shared: readonly string[], format: SpreadsheetCellFormat | undefined, date1904: boolean, copyFormat = true): SpreadsheetCell {
  const type = node.attributes.t, raw = textContent(child(node, "v"));
  if (child(node, "f") && !child(node, "v") && !child(node, "is")) return { value: "", ...(format ? { format: copyFormat ? { ...format } : format } : {}) };
  let value = raw, text = false;
  if (type === "s") {
    if (!/^\d+$/.test(raw) || shared[Number(raw)] === undefined) return fail("共有文字列の参照が不正です");
    value = shared[Number(raw)]; text = true;
  } else if (type === "inlineStr") { value = richText(child(node, "is")); text = true; }
  else if (type === "str") { value = spreadsheetText(raw); text = true; }
  else if (type === "b") { if (!["0", "1", "true", "false"].includes(raw)) return fail("真偽値が不正です"); value = raw === "0" || raw === "false" ? "FALSE" : "TRUE"; }
  else if (type === "d") {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) return fail("日付セルが不正です");
    format = { ...format, numberFormat: raw.includes("T") ? "datetime" : "date" };
  } else if (type === undefined || type === "n") {
    if (raw && (!numeric.test(raw) || !Number.isFinite(Number(raw)))) return fail("数値セルが不正です");
    if (raw && date1904 && ["date", "datetime"].includes(format?.numberFormat ?? "")) value = String(Number(raw) + 1462);
  } else if (type === "e") { if (!excelErrors.has(raw)) return fail("エラーセルの値が不正です"); }
  else return fail("セルの種類が不正です");
  if (value.length > SPREADSHEET_LIMITS.cellLength) return fail("セルの文字数が100,000文字を超えています");
  // Model text cells retain numeric-looking text and never interpret leading '=' as a formula.
  if (text) { format = { ...format, numberFormat: "text" }; if (value.startsWith("'")) value = `'${value}`; }
  return { value, ...(format ? { format: copyFormat ? { ...format } : format } : {}) };
}
export async function readWorksheet(node: XmlNode, id: string, name: string, shared: readonly string[], styles: readonly (SpreadsheetCellFormat | undefined)[], date1904: boolean, context: ImportContext): Promise<SpreadsheetSheet> {
  if (localName(node.name) !== "worksheet") return fail("ワークシートではありません");
  const warn = (code: "omitted" | "adjusted" | "unsupported", message: string, count = 1) => context.warn({ code, message, sheetName: name, count });
  const cells: Record<string, SpreadsheetCell> = Object.create(null), rowHeights: Record<number, number> = {}, columnWidths: Record<number, number> = {};
  let rowCount: number = DEFAULT_SHEET_SIZE.rowCount, columnCount: number = DEFAULT_SHEET_SIZE.columnCount, cellCount = 0;
  const pending: { address: string; row: number; column: number; formula: XmlNode; cached: SpreadsheetCell }[] = [];
  const sharedFormulas = new Map<string, { formula: string; row: number; column: number; range?: SpreadsheetMergedRange }>();
  const sizes = (value: number) => Math.min(1000, Math.max(1, value));
  const reserveText = (length: number) => {
    context.cellTextCharacters = (context.cellTextCharacters ?? 0) + length;
    if (context.cellTextCharacters > XLSX_IMPORT_LIMITS.cellTextCharacters) return fail("展開後のセル文字数の合計が32 Mi文字を超えています");
  };
  const seenRows = new Set<number>();
  let inferredRow = 0;
  for (const row of children(child(node, "sheetData"), "row")) {
    const rowIndex = row.attributes.r === undefined ? inferredRow : Number(row.attributes.r) - 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= 1_048_576) return fail("行番号が不正です");
    if (seenRows.has(rowIndex)) return fail("行が重複しています");
    seenRows.add(rowIndex);
    inferredRow = rowIndex + 1;
    if (row.attributes.hidden === "1" || row.attributes.hidden === "true") warn("adjusted", "非表示の行・列を表示状態で読み込みました");
    if (row.attributes.ht !== undefined) {
      const height = Number(row.attributes.ht) / 0.75;
      if (!Number.isFinite(height) || height < 0) warn("adjusted", "不正な行高を標準の高さへ変更しました");
      else if (rowIndex < SPREADSHEET_LIMITS.rows) { rowHeights[rowIndex] = sizes(height); rowCount = Math.max(rowCount, rowIndex + 1); if (height !== rowHeights[rowIndex]) warn("adjusted", "行・列のサイズを対応範囲へ調整しました"); }
      else warn("omitted", "シート上限外の空行・空列の表示設定を省略しました");
    }
    if (row.attributes.s !== undefined) warn("omitted", "行全体・列全体の書式設定を省略しました");
    let inferredColumn = 0;
    const seenCells = new Set<number>();
    for (const item of children(row, "c")) {
      cellCount++;
      if (cellCount % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
      const position = item.attributes.r ? readExcelCellAddress(item.attributes.r) : { row: rowIndex, column: inferredColumn };
      if (!position || position.row !== rowIndex || position.column >= 16_384) return fail("セルの位置が不正です");
      inferredColumn = position.column + 1;
      if (seenCells.has(position.column)) return fail("セルが重複しています");
      seenCells.add(position.column);
      const styleId = Number(item.attributes.s ?? 0);
      const validStyle = Number.isInteger(styleId) && styleId >= 0 && styleId < styles.length;
      if (!validStyle) warn("adjusted", "参照先が不正なセル書式を標準書式へ変更しました（セルの値・数式は保持）");
      const value = readWorksheetCellValue(item, shared, validStyle ? styles[styleId] : undefined, date1904), formula = child(item, "f");
      if (position.row >= SPREADSHEET_LIMITS.rows || position.column >= SPREADSHEET_LIMITS.columns) {
        if (value.value || formula) return fail(`シート「${name}」のセル ${excelCellAddress(position)} は値・数式を持ち、10,000行・1,000列の上限を超えています`);
        warn("omitted", "シート上限外の値・数式を持たない空セルとその書式を省略しました");
        continue;
      }
      // Empty source placeholders do not consume the stored-cell budget.
      if (!value.value && !value.format && !formula) continue;
      const address = cellAddress(position.row, position.column);
      reserveText(value.value.length);
      cells[address] = value;
      rowCount = Math.max(rowCount, position.row + 1); columnCount = Math.max(columnCount, position.column + 1);
      if (child(child(item, "is"), "r")) warn("adjusted", "セル内の文字ごとの書式を単一の書式へ変更しました");
      if (formula) {
        pending.push({ address, ...position, formula, cached: value });
        if (formula.attributes.t === "shared" && textContent(formula)) {
          const key = formula.attributes.si;
          if (!key || !/^\d+$/.test(key) || sharedFormulas.has(key) && formula.attributes.ref !== undefined) return fail("共有数式が重複または不正です");
          // OOXML allows redundant expression text on dependents; their master must win.
          if (!sharedFormulas.has(key)) sharedFormulas.set(key, { formula: importFormula(textContent(formula), context), ...position,
            ...(formula.attributes.ref !== undefined ? { range: sharedFormulaRange(formula.attributes.ref) } : {}) });
        }
      }
    }
  }
  for (const [index, { address, row, column, formula, cached }] of pending.entries()) {
    let value = importFormula(textContent(formula), context);
    let supported = [undefined, "normal", "shared"].includes(formula.attributes.t) && !date1904;
    if (formula.attributes.t === "shared") {
      const master = sharedFormulas.get(formula.attributes.si);
      if (!master) return fail("共有数式の元データがありません");
      if (master.range && (row < master.range.top || row > master.range.bottom || column < master.range.left || column > master.range.right)) return fail("共有数式の参照範囲が不正です");
      if ((context.cellTextCharacters ?? 0) + master.formula.length > XLSX_IMPORT_LIMITS.cellTextCharacters) return fail("展開後のセル文字数の合計が32 Mi文字を超えています");
      try { value = translateFormula(master.formula, row - master.row, column - master.column); } catch { supported = false; }
    }
    if (supported && supportedFormula(value)) {
      reserveText(value.length - cached.value.length);
      const format = { ...cached.format }; if (format.numberFormat === "text") delete format.numberFormat;
      cells[address] = { value, ...(Object.keys(format).length ? { format } : {}) };
    } else {
      warn("unsupported", "未対応の数式を保存済みの計算結果へ置き換えました（結果のないセルは空欄）");
      cells[address] = cached;
    }
    if (index % 256 === 255) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
  }
  const seenColumns = new Set<number>();
  for (const col of children(child(node, "cols"), "col")) {
    const min = Number(col.attributes.min), max = Number(col.attributes.max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 16_384) { warn("omitted", "範囲が不正な列の表示設定を省略しました"); continue; }
    if (["1", "true"].includes(col.attributes.hidden)) warn("adjusted", "非表示の行・列を表示状態で読み込みました");
    if (col.attributes.style !== undefined) warn("omitted", "行全体・列全体の書式設定を省略しました");
    if (col.attributes.width !== undefined) {
      const storedWidth = Number(col.attributes.width);
      const width = xlsxColumnWidthToPixels(storedWidth, context.columnWidthMetrics);
      if (!Number.isFinite(storedWidth) || storedWidth < 0 || !Number.isFinite(width)) { warn("adjusted", "不正な列幅を標準の幅へ変更しました"); continue; }
      let duplicated = false;
      for (let index = min - 1; index < Math.min(max, SPREADSHEET_LIMITS.columns); index++) {
        if (seenColumns.has(index)) { duplicated = true; continue; }
        seenColumns.add(index); columnWidths[index] = sizes(width);
      }
      if (duplicated) warn("omitted", "重複する列の表示設定を省略し、最初の有効な列幅を保持しました");
      if (min <= SPREADSHEET_LIMITS.columns) columnCount = Math.max(columnCount, Math.min(max, SPREADSHEET_LIMITS.columns));
      if (width !== sizes(width)) warn("adjusted", "行・列のサイズを対応範囲へ調整しました");
      if (max > SPREADSHEET_LIMITS.columns) warn("omitted", "シート上限外の空行・空列の表示設定を省略しました");
    }
  }
  const mergeNodes = children(child(node, "mergeCells"), "mergeCell");
  const candidates: SpreadsheetMergedRange[] = [];
  const mergeIndexes: { ranges: SpreadsheetMergedRange[]; index: SpreadsheetMergeIndex | undefined }[] = [];
  // A sparse range index distinguishes presentation-only merges from retained cell content.
  const content = mergeNodes.length ? indexContentRows(cells) : undefined;
  for (const [index, item] of mergeNodes.entries()) {
    if (index % 1024 === 1023) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
    let range: SpreadsheetMergedRange;
    try { range = importRange(item.attributes.ref ?? ""); }
    catch { warn("omitted", "不正またはシート上限外の結合指定を省略しました（セルの値・数式は保持）"); continue; }
    if (range.top === range.bottom && range.left === range.right) { warn("omitted", "1セルだけの結合指定を省略しました"); continue; }
    if (hasCoveredContent(content, range, !!cells[cellAddress(range.top, range.left)]?.value)) {
      warn("adjusted", "結合範囲の左上以外に値・数式があるため、内容を保持して結合を解除しました"); continue;
    }
    if ((context.mergeCount ?? 0) + candidates.length >= SPREADSHEET_LIMITS.merges) {
      warn("omitted", `ブック全体の結合範囲上限（${SPREADSHEET_LIMITS.merges}件）を超える結合指定を省略しました（セルの値・数式は保持）`); continue;
    }
    if (mergeIndexes.some(previous => indexedRangesOverlap(previous?.index, range))) {
      warn("omitted", "重複する結合指定を省略し、最初の有効な結合を保持しました"); continue;
    }
    candidates.push(range);
    // Binary-sized batches keep overlap lookup bounded even for many duplicate declarations.
    let ranges = [range], level = 0;
    while (mergeIndexes[level]) { ranges = [...mergeIndexes[level].ranges, ...ranges]; delete mergeIndexes[level++]; }
    mergeIndexes[level] = { ranges, index: indexMerges(ranges) };
    rowCount = Math.max(rowCount, range.bottom + 1); columnCount = Math.max(columnCount, range.right + 1);
  }
  const merges = normalizeMerges(candidates, { rowCount, columnCount, name }) ?? [];
  context.mergeCount = (context.mergeCount ?? 0) + merges.length;
  const defaults = worksheetDefaultSizes(node, context.columnWidthMetrics);
  if (defaults.invalid) warn("adjusted", "不正な標準の行高・列幅を標準寸法へ変更しました");
  if (defaults.adjusted) warn("adjusted", "行・列のサイズを対応範囲へ調整しました");
  for (let row = 0; row < rowCount; row++) rowHeights[row] ??= defaults.row;
  for (let column = 0; column < columnCount; column++) columnWidths[column] ??= defaults.column;
  const ignored = ["conditionalFormatting", "sheetProtection", "autoFilter", "sheetViews", "hyperlinks", "oleObjects", "controls", "extLst", "pageSetup", "headerFooter", "rowBreaks", "colBreaks"];
  for (const key of ignored) if (child(node, key) && (key !== "sheetViews" || child(child(node, "sheetViews")?.children[0], "pane"))) warn("omitted", `${({ conditionalFormatting: "条件付き書式", sheetProtection: "シート保護", autoFilter: "フィルター状態", sheetViews: "ウィンドウ枠の固定", hyperlinks: "ハイパーリンク", oleObjects: "埋め込みオブジェクト", controls: "フォームコントロール", extLst: "拡張機能", pageSetup: "印刷設定", headerFooter: "ヘッダー・フッター", rowBreaks: "改ページ", colBreaks: "改ページ" } as Record<string, string>)[key]}を省略しました`);
  return { id, name, cells, rowCount, columnCount, ...(Object.keys(rowHeights).length ? { rowHeights } : {}), ...(Object.keys(columnWidths).length ? { columnWidths } : {}), ...(merges.length ? { merges } : {}) };
}

function indexedRangesOverlap(index: SpreadsheetMergeIndex | undefined, range: SpreadsheetMergedRange): boolean {
  if (!index) return false;
  let low = 0, high = index.byColumn.length;
  while (low < high) { const middle = (low + high) >>> 1; if (index.byColumn[middle].right < range.left) low = middle + 1; else high = middle; }
  for (let position = low; position < index.byColumn.length && index.byColumn[position].left <= range.right; position++)
    if (rangesIntersect(index.byColumn[position], range)) return true;
  return range.top < index.center && indexedRangesOverlap(index.before, range) ||
    range.bottom > index.center && indexedRangesOverlap(index.after, range);
}

type ContentRowIndex = { top: number; bottom: number; columns: number[]; before?: ContentRowIndex; after?: ContentRowIndex };
function indexContentRows(cells: Record<string, SpreadsheetCell>): ContentRowIndex | undefined {
  const rows = new Map<number, number[]>();
  for (const [address, cell] of Object.entries(cells)) if (cell.value) {
    const position = parseCellAddress(address)!;
    const columns = rows.get(position.row) ?? []; columns.push(position.column); rows.set(position.row, columns);
  }
  const entries = [...rows].sort((a, b) => a[0] - b[0]);
  const build = (start: number, end: number): ContentRowIndex | undefined => {
    if (start === end) return undefined;
    const columns = entries.slice(start, end).flatMap(([, values]) => values).sort((a, b) => a - b);
    const result: ContentRowIndex = { top: entries[start][0], bottom: entries[end - 1][0], columns };
    if (end - start > 1) { const middle = (start + end) >>> 1; result.before = build(start, middle); result.after = build(middle, end); }
    return result;
  };
  return build(0, entries.length);
}
function lowerBound(values: readonly number[], value: number): number {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle] < value) low = middle + 1; else high = middle; }
  return low;
}
function hasCoveredContent(index: ContentRowIndex | undefined, range: SpreadsheetMergedRange, hasAnchor: boolean): boolean {
  const count = (node: ContentRowIndex | undefined): number => {
    if (!node || node.bottom < range.top || node.top > range.bottom) return 0;
    if (node.top >= range.top && node.bottom <= range.bottom)
      return lowerBound(node.columns, range.right + 1) - lowerBound(node.columns, range.left);
    return count(node.before) + count(node.after);
  };
  return count(index) > (hasAnchor ? 1 : 0);
}
