import { cellAddress, parseCellAddress } from "./address";
import { moveFormulaReference, rewriteFormulaReferences, type FormulaReference } from "./formula";
import { commentsEqual, drawingsEqual, normalizeComment, normalizeComments, normalizeDrawing, normalizeDrawings } from "./annotations";
import { normalizeResources, pruneImageResources, validateObjectId } from "./image-resources";
import { getMergedRange, mergedCellPosition, mergedContentWouldBeDiscarded, normalizeMerges, rangeContains, rangesIntersect, validateMergedContents, validateMergedRange } from "./merges";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetMoveSource, type SpreadsheetMoveTarget,
  type SpreadsheetSheet, type SpreadsheetWorkbook, type SpreadsheetDrawing, type SpreadsheetDrawingPatch,
  type SpreadsheetComment, type SpreadsheetImageDrawing, type SpreadsheetImageResource, type SpreadsheetMergedRange } from "./types";

const fail = (message: string): never => { throw new Error(message); };
function dimension(value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail("行数または列数が上限を超えています");
  return value;
}
function sheetName(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 31 || /[\[\]:*?/\\\u0000-\u001f]/.test(value) || /^'|'$/.test(value.trim()))
    return fail("シート名は31文字以内で、空欄や [ ] : * ? / \\ を含めないでください");
  return value.trim();
}
function ensureUniqueName(workbook: SpreadsheetWorkbook, name: string, except?: string) {
  if (workbook.sheets.some(sheet => sheet.id !== except && sheet.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")))
    fail("同じ名前のシートがあります");
}
function cellFormat(value: SpreadsheetCellFormat | undefined): SpreadsheetCellFormat | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("セルの書式が正しくありません");
  const result: SpreadsheetCellFormat = {};
  for (const key of ["bold", "italic", "underline"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "boolean") fail("セルの書式が正しくありません");
    result[key] = value[key];
  }
  for (const key of ["color", "background"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "string" || value[key].length > 100 || /[;{}<>]/.test(value[key])) fail("セルの色が正しくありません");
    if (value[key]) result[key] = value[key];
  }
  if (value.align !== undefined) {
    if (!["left", "center", "right"].includes(value.align)) fail("文字の配置が正しくありません");
    result.align = value.align;
  }
  if (value.numberFormat !== undefined) {
    if (!["general", "number", "currency", "percent"].includes(value.numberFormat)) fail("数値の書式が正しくありません");
    result.numberFormat = value.numberFormat;
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}
function cellValue(value: string) {
  if (typeof value !== "string" || value.length > SPREADSHEET_LIMITS.cellLength) fail("セルの値は100,000文字以内の文字列で指定してください");
  return value;
}
function sizes(input: Readonly<Record<number, number>> | undefined, count: number, row = false) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("行列のサイズが正しくありません");
  const result: Record<number, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(value) || value < (row ? 16 : 24) || value > 1000)
      fail("行列のサイズが範囲外です");
    result[index] = value;
  }
  return Object.freeze(result);
}
function freezeCell(value: string, format?: SpreadsheetCellFormat): SpreadsheetCell {
  return Object.freeze(format ? { value, format } : { value });
}
function finish(sheets: readonly SpreadsheetSheet[], workbook?: SpreadsheetWorkbook,
  resources = workbook?.resources): SpreadsheetWorkbook {
  if (sheets.reduce((count, sheet) => count + Object.keys(sheet.cells).length, 0) > SPREADSHEET_LIMITS.cells)
    fail("保存できるセル数の上限を超えています");
  if (sheets.reduce((count, sheet) => count + (sheet.drawings?.length ?? 0), 0) > SPREADSHEET_LIMITS.drawings)
    fail("描画オブジェクトの数が上限を超えています");
  if (sheets.reduce((count, sheet) => count + Object.keys(sheet.comments ?? {}).length, 0) > SPREADSHEET_LIMITS.comments)
    fail("コメントの数が上限を超えています");
  if (sheets.reduce((count, sheet) => count + (sheet.merges?.length ?? 0), 0) > SPREADSHEET_LIMITS.merges)
    fail("結合範囲の数が上限を超えています");
  return Object.freeze({ schemaVersion: 1, sheets: Object.freeze([...sheets]), ...(resources ? { resources } : {}) });
}
function withSheet(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet): SpreadsheetWorkbook {
  return finish(workbook.sheets.map(item => item.id === sheet.id ? Object.freeze(sheet) : item), workbook);
}
function getSheet(workbook: SpreadsheetWorkbook, id: string): SpreadsheetSheet {
  return workbook.sheets.find(sheet => sheet.id === id) ?? fail("シートが見つかりません");
}
function addressFor(sheet: SpreadsheetSheet, address: string): string {
  const position = parseCellAddress(address);
  if (!position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) return fail("セルの位置がシートの範囲外です");
  return cellAddress(position.row, position.column);
}

/** Validate and copy the complete host boundary. No empty cell matrix is allocated. */
export function normalizeWorkbook(input?: SpreadsheetWorkbook): SpreadsheetWorkbook {
  if (input === undefined) return createWorkbook();
  if (!input || !Array.isArray(input.sheets) || input.sheets.length < 1 || input.sheets.length > SPREADSHEET_LIMITS.sheets)
    return fail("ブックには1〜100枚のシートが必要です");
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) return fail("未対応のブック形式です");
  const resources = normalizeResources(input.resources);
  const ids = new Set<string>(), names = new Set<string>();
  let cellCount = 0;
  const sheets = input.sheets.map(sheet => {
    if (!sheet || typeof sheet.id !== "string" || !sheet.id || sheet.id.length > 200 || /\0/.test(sheet.id) || ids.has(sheet.id))
      return fail("シートの ID が空、重複、または不正です");
    ids.add(sheet.id);
    const name = sheetName(sheet.name), key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) return fail("同じ名前のシートがあります");
    names.add(key);
    const rowCount = dimension(sheet.rowCount, SPREADSHEET_LIMITS.rows), columnCount = dimension(sheet.columnCount, SPREADSHEET_LIMITS.columns);
    if (!sheet.cells || typeof sheet.cells !== "object" || Array.isArray(sheet.cells)) return fail("セルの一覧が正しくありません");
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (++cellCount > SPREADSHEET_LIMITS.cells) return fail("保存できるセル数の上限を超えています");
      const canonical = addressFor(sheet, address);
      if (Object.hasOwn(cells, canonical)) return fail("同じ位置のセルが重複しています");
      if (!cell || typeof cell !== "object") return fail("セルの値が正しくありません");
      const item = cell as SpreadsheetCell;
      const value = cellValue(item.value), format = cellFormat(item.format);
      if (value || format) cells[canonical] = freezeCell(value, format);
    }
    const columnWidths = sizes(sheet.columnWidths, columnCount), rowHeights = sizes(sheet.rowHeights, rowCount, true);
    const drawings = normalizeDrawings(sheet.drawings, { rowCount, columnCount }, resources);
    const comments = normalizeComments(sheet.comments, { rowCount, columnCount });
    const merges = normalizeMerges(sheet.merges, { rowCount, columnCount });
    validateMergedContents({ cells, comments, merges });
    return Object.freeze({ id: sheet.id, name, cells: Object.freeze(cells), rowCount, columnCount,
      ...(columnWidths ? { columnWidths } : {}), ...(rowHeights ? { rowHeights } : {}),
      ...(drawings ? { drawings } : {}), ...(comments ? { comments } : {}), ...(merges ? { merges } : {}) });
  });
  return finish(sheets, undefined, resources);
}

export function createWorkbook(): SpreadsheetWorkbook {
  return finish([Object.freeze({ id: "sheet-1", name: "Sheet1", cells: Object.freeze({}), rowCount: 100, columnCount: 26 })]);
}

export function setCellValue(workbook: SpreadsheetWorkbook, sheetId: string, address: string, value: string): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), position = mergedCellPosition(sheet, parseCellAddress(addressFor(sheet, address))!);
  return setCellValues(workbook, sheetId, { [cellAddress(position.row, position.column)]: value });
}
export function setCellValues(workbook: SpreadsheetWorkbook, sheetId: string, values: Readonly<Record<string, string>>): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), cells = { ...sheet.cells };
  let changed = false;
  for (const [address, raw] of Object.entries(values)) {
    const key = addressFor(sheet, address), value = cellValue(raw), previous = cells[key];
    const merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (value && merge && key !== cellAddress(merge.top, merge.left)) return fail("結合セルの値は左上のセルにだけ入力してください");
    if ((previous?.value ?? "") === value) continue;
    changed = true;
    if (!value && !previous?.format) delete cells[key];
    else cells[key] = freezeCell(value, previous?.format);
  }
  return changed ? withSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}

/** Merge a rectangle. Discarding covered values/comments requires an explicit caller decision. */
export function mergeCells(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetMergedRange,
  options: { discardValues?: boolean } = {}): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  validateMergedRange(range, sheet);
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    (options.discardValues !== undefined && typeof options.discardValues !== "boolean"))
    return fail("結合時の値の破棄は true または false で指定してください");
  const existing = sheet.merges ?? [];
  for (const merge of existing) if (rangesIntersect(range, merge) && !rangeContains(range, merge))
    return fail("結合セルの一部分だけを結合できません。結合範囲全体を選択してください");
  if (existing.some(merge => rangeContains(range, merge) && rangeContains(merge, range))) return workbook;
  if (!options.discardValues && mergedContentWouldBeDiscarded(sheet, range))
    return fail("結合すると左上以外のセルの値とコメントが失われます");
  const cells = { ...sheet.cells }, comments = { ...sheet.comments }, anchor = cellAddress(range.top, range.left);
  const covered = (address: string) => {
    if (address === anchor) return false;
    const { row, column } = parseCellAddress(address)!;
    return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
  };
  for (const [address, cell] of Object.entries(cells)) if (covered(address) && cell.value) {
    if (cell.format) cells[address] = freezeCell("", cell.format);
    else delete cells[address];
  }
  for (const address of Object.keys(comments)) if (covered(address)) {
    delete comments[address];
  }
  const merges = normalizeMerges([...existing.filter(merge => !rangesIntersect(range, merge)), range], sheet);
  return withSheet(workbook, { ...sheet, cells: Object.freeze(cells), merges,
    ...(sheet.comments ? { comments: Object.freeze(comments) } : {}) });
}

/** Unmerge every intersected range; deleted covered values are not reconstructed. */
export function unmergeCells(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetMergedRange): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  validateMergedRange(range, sheet, true);
  const merges = sheet.merges?.filter(merge => !rangesIntersect(range, merge));
  if (!merges || merges.length === sheet.merges?.length) return workbook;
  return withSheet(workbook, { ...sheet, merges: merges.length ? Object.freeze(merges) : undefined });
}

export function formatCells(workbook: SpreadsheetWorkbook, sheetId: string, addresses: readonly string[], format: Partial<SpreadsheetCellFormat>): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), cells = { ...sheet.cells };
  // Validate before examining cells so a bad request is rejected atomically.
  cellFormat(format);
  let changed = false;
  for (const address of addresses) {
    const key = addressFor(sheet, address), previous = cells[key], next = cellFormat({ ...previous?.format, ...format });
    if (JSON.stringify(previous?.format) === JSON.stringify(next)) continue;
    changed = true;
    if (!previous?.value && !next) delete cells[key];
    else cells[key] = freezeCell(previous?.value ?? "", next);
  }
  return changed ? withSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}

export function resizeColumn(workbook: SpreadsheetWorkbook, sheetId: string, column: number, width: number): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  if (!Number.isInteger(column) || column < 0 || column >= sheet.columnCount || !Number.isFinite(width)) return fail("列の位置または幅が正しくありません");
  const value = Math.min(1000, Math.max(24, Math.round(width)));
  if ((sheet.columnWidths?.[column] ?? 100) === value) return workbook;
  return withSheet(workbook, { ...sheet, columnWidths: Object.freeze({ ...sheet.columnWidths, [column]: value }) });
}

function coordinateAfter(value: number, index: number, count: number, remove: boolean): number | null {
  if (!remove) return value >= index ? value + count : value;
  return value < index ? value : value >= index + count ? value - count : null;
}
function intervalAfter(first: number, last: number, index: number, count: number, remove: boolean): [number, number] | null {
  if (!remove) return [coordinateAfter(first, index, count, false)!, coordinateAfter(last, index, count, false)!];
  const low = Math.min(first, last), high = Math.max(first, last), end = index + count;
  if (low >= index && high < end) return null;
  const start = low < index ? low : Math.max(low, end) - count;
  const finish = high >= end ? high - count : Math.min(high, index - 1);
  return first <= last ? [start, finish] : [finish, start];
}
function transformReferences(formula: string, currentName: string, targetName: string,
  axis: "row" | "column", index: number, count: number, remove: boolean) {
  const matches = (reference: FormulaReference, inherited = currentName) => (reference.sheet ?? inherited).toLocaleLowerCase("en-US") === targetName.toLocaleLowerCase("en-US");
  const single = (reference: FormulaReference) => {
    if (!matches(reference)) return undefined;
    const position = parseCellAddress(reference.address);
    if (!position) return "#REF!";
    const next = coordinateAfter(position[axis], index, count, remove);
    if (next === null) return "#REF!";
    return moveFormulaReference(reference, axis === "row" ? next : position.row, axis === "column" ? next : position.column);
  };
  return rewriteFormulaReferences(formula, single, (first, last) => {
    const firstMatches = matches(first), lastMatches = matches(last, first.sheet ?? currentName);
    if (!firstMatches && !lastMatches) return undefined;
    const a = parseCellAddress(first.address), b = parseCellAddress(last.address);
    if (!a || !b) return "#REF!";
    if (firstMatches !== lastMatches) return "#REF!";
    const next = intervalAfter(a[axis], b[axis], index, count, remove);
    if (!next) return "#REF!";
    return `${moveFormulaReference(first, axis === "row" ? next[0] : a.row, axis === "column" ? next[0] : a.column)}:${moveFormulaReference(last, axis === "row" ? next[1] : b.row, axis === "column" ? next[1] : b.column)}`;
  });
}
function shiftSizes(input: Readonly<Record<number, number>> | undefined, index: number, count: number, remove: boolean) {
  if (!input) return undefined;
  const result: Record<number, number> = {};
  for (const [key, size] of Object.entries(input)) {
    const next = coordinateAfter(Number(key), index, count, remove);
    if (next !== null) result[next] = size;
  }
  return Object.freeze(result);
}
function shiftMerges(sheet: SpreadsheetSheet, axis: "row" | "column", index: number, count: number, remove: boolean, total: number) {
  if (!sheet.merges?.length) return sheet.merges;
  const ranges: SpreadsheetMergedRange[] = [];
  for (const merge of sheet.merges) {
    const interval = intervalAfter(axis === "row" ? merge.top : merge.left,
      axis === "row" ? merge.bottom : merge.right, index, count, remove);
    if (!interval) continue;
    const next = axis === "row" ? { ...merge, top: interval[0], bottom: interval[1] }
      : { ...merge, left: interval[0], right: interval[1] };
    if (next.top !== next.bottom || next.left !== next.right) ranges.push(next);
  }
  return normalizeMerges(ranges, { rowCount: axis === "row" ? total : sheet.rowCount,
    columnCount: axis === "column" ? total : sheet.columnCount });
}
function shiftAnnotations(sheet: SpreadsheetSheet, axis: "row" | "column", index: number, count: number, remove: boolean, total: number) {
  const comments: Record<string, SpreadsheetComment> = Object.create(null);
  for (const [address, comment] of Object.entries(sheet.comments ?? {})) {
    const position = parseCellAddress(address)!, next = coordinateAfter(position[axis], index, count, remove);
    if (next !== null) comments[cellAddress(axis === "row" ? next : position.row, axis === "column" ? next : position.column)] = comment;
  }
  const drawings = sheet.drawings?.map(drawing => {
    const next = coordinateAfter(drawing.anchor[axis], index, count, remove) ?? Math.min(index, total - 1);
    if (next === drawing.anchor[axis]) return drawing;
    return Object.freeze({ ...drawing, anchor: Object.freeze({ ...drawing.anchor, [axis]: next }) });
  });
  return { ...(sheet.comments ? { comments: Object.freeze(comments) } : {}), ...(drawings ? { drawings: Object.freeze(drawings) } : {}) };
}

function changeAxis(workbook: SpreadsheetWorkbook, sheetId: string, axis: "row" | "column", index: number, count: number, remove: boolean): SpreadsheetWorkbook {
  const target = getSheet(workbook, sheetId), limit = axis === "row" ? target.rowCount : target.columnCount;
  if (!Number.isInteger(index) || index < 0 || index > limit || !Number.isInteger(count) || count < 1 || (remove && index + count > limit))
    return fail("挿入・削除する行列の範囲が正しくありません");
  const total = dimension(limit + (remove ? -count : count), axis === "row" ? SPREADSHEET_LIMITS.rows : SPREADSHEET_LIMITS.columns);
  return finish(workbook.sheets.map(sheet => {
    let changed = sheet.id === sheetId;
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    for (const [address, cell] of Object.entries(sheet.cells)) {
      let nextAddress = address;
      if (sheet.id === sheetId) {
        const position = parseCellAddress(address)!;
        const next = coordinateAfter(position[axis], index, count, remove);
        if (next === null) continue;
        nextAddress = cellAddress(axis === "row" ? next : position.row, axis === "column" ? next : position.column);
      }
      const value = transformReferences(cell.value, sheet.name, target.name, axis, index, count, remove);
      if (value !== cell.value) changed = true;
      cells[nextAddress] = value === cell.value ? cell : freezeCell(value, cell.format);
    }
    if (!changed) return sheet;
    return Object.freeze({ ...sheet, cells: Object.freeze(cells),
      ...(sheet.id === sheetId && sheet.merges ? { merges: shiftMerges(sheet, axis, index, count, remove, total) } : {}),
      ...(sheet.id === sheetId ? shiftAnnotations(sheet, axis, index, count, remove, total) : {}), ...(sheet.id === sheetId ? axis === "row"
      ? { rowCount: total, rowHeights: shiftSizes(sheet.rowHeights, index, count, remove) }
      : { columnCount: total, columnWidths: shiftSizes(sheet.columnWidths, index, count, remove) } : {}) });
  }), workbook);
}
export function insertRows(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "row", index, count, false); }
export function deleteRows(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "row", index, count, true); }
export function insertColumns(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "column", index, count, false); }
export function deleteColumns(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "column", index, count, true); }

/** Cut/paste preserves the referenced cells, rather than applying copy-style relative offsets.
 * A partially intersected range cannot be represented as one rectangle and is rejected atomically. */
export function moveCells(workbook: SpreadsheetWorkbook, source: SpreadsheetMoveSource, destination: SpreadsheetMoveTarget): SpreadsheetWorkbook {
  const from = getSheet(workbook, source.sheetId), to = getSheet(workbook, destination.sheetId);
  if (![source.top, source.left, source.bottom, source.right, destination.row, destination.column].every(Number.isInteger) ||
    source.top < 0 || source.left < 0 || source.bottom < source.top || source.right < source.left ||
    source.bottom >= from.rowCount || source.right >= from.columnCount || destination.row < 0 || destination.column < 0)
    return fail("切り取り元・貼り付け先の範囲が正しくありません");
  const height = source.bottom - source.top + 1, width = source.right - source.left + 1;
  if (height * width > SPREADSHEET_LIMITS.clipboardCells) return fail("一度に移動できるのは10,000セルまでです");
  if (destination.row + height > to.rowCount || destination.column + width > to.columnCount) return fail("貼り付け先がシートの範囲外です");
  const destinationRange = { top: destination.row, left: destination.column,
    bottom: destination.row + height - 1, right: destination.column + width - 1 };
  const sourceMerges = (from.merges ?? []).filter(merge => rangesIntersect(source, merge));
  if (sourceMerges.some(merge => !rangeContains(source, merge)))
    return fail("結合セルの一部分だけは移動できません。結合範囲全体を選択してください");
  for (const merge of to.merges ?? []) {
    if (from.id === to.id && rangeContains(source, merge)) continue;
    if (rangesIntersect(destinationRange, merge) && !rangeContains(destinationRange, merge))
      return fail("貼り付け先に結合セルの一部分が含まれています。結合範囲全体を選択してください");
  }
  if (source.sheetId === destination.sheetId && source.top === destination.row && source.left === destination.column) return workbook;
  const inSource = (row: number, column: number) => row >= source.top && row <= source.bottom && column >= source.left && column <= source.right;
  const inDestination = (row: number, column: number) => row >= destination.row && row < destination.row + height && column >= destination.column && column < destination.column + width;
  const equalName = (a: string, b: string) => a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
  const qualifier = (name: string) => `'${name.replaceAll("'", "''")}'!`;
  const staged = workbook.sheets.map(sheet => {
    if (sheet.id !== from.id && sheet.id !== to.id) return sheet;
    const cells = { ...sheet.cells }, comments = { ...sheet.comments };
    if (sheet.id === from.id) for (const address of Object.keys(cells)) {
      const position = parseCellAddress(address)!;
      if (inSource(position.row, position.column)) delete cells[address];
    }
    if (sheet.id === from.id) for (const address of Object.keys(comments)) {
      const position = parseCellAddress(address)!;
      if (inSource(position.row, position.column)) delete comments[address];
    }
    if (sheet.id === to.id) for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const cell = from.cells[cellAddress(source.top + row, source.left + column)];
      const target = cellAddress(destination.row + row, destination.column + column);
      if (cell) cells[target] = cell;
      else delete cells[target];
      const comment = from.comments?.[cellAddress(source.top + row, source.left + column)];
      if (comment) comments[target] = comment;
      else delete comments[target];
    }
    const ids = new Set<string>();
    for (const comment of Object.values(comments)) {
      if (ids.has(comment.id)) return fail("移動先に同じ ID のコメントがあります");
      ids.add(comment.id);
    }
    const retainedMerges = (sheet.merges ?? []).filter(merge =>
      !(sheet.id === from.id && rangeContains(source, merge)) && !(sheet.id === to.id && rangeContains(destinationRange, merge)));
    const movedMerges = sheet.id === to.id ? sourceMerges.map(merge => ({
      top: merge.top + destination.row - source.top, bottom: merge.bottom + destination.row - source.top,
      left: merge.left + destination.column - source.left, right: merge.right + destination.column - source.left,
    })) : [];
    return { ...sheet, cells, ...(sheet.merges || movedMerges.length ? { merges: normalizeMerges([...retainedMerges, ...movedMerges], sheet) } : {}),
      ...(sheet.comments || Object.keys(comments).length ? { comments: Object.freeze(comments) } : {}) };
  });
  const result = staged.map(sheet => {
    let changed = sheet.id === from.id || sheet.id === to.id;
    const cells = { ...sheet.cells };
    for (const [address, cell] of Object.entries(cells)) {
      if (!cell.value.startsWith("=")) continue;
      const position = parseCellAddress(address)!;
      const origin = sheet.id === to.id && inDestination(position.row, position.column) ? from.name : sheet.name;
      const resolve = (reference: FormulaReference, inherited = origin) => reference.sheet ?? inherited;
      const rewrite = (reference: FormulaReference, inherited = origin): string => {
        const name = resolve(reference, inherited), original = parseCellAddress(reference.address);
        if (!original) return "#REF!";
        const moved = equalName(name, from.name) && inSource(original.row, original.column);
        const targetName = moved ? to.name : name;
        const prefix = moved || (!reference.sheet && !equalName(name, sheet.name))
          ? equalName(targetName, sheet.name) && !reference.prefix ? "" : qualifier(targetName)
          : reference.prefix;
        return moveFormulaReference({ ...reference, prefix },
          moved ? destination.row + original.row - source.top : original.row,
          moved ? destination.column + original.column - source.left : original.column);
      };
      const value = rewriteFormulaReferences(cell.value, reference => rewrite(reference), (first, last) => {
        const firstName = resolve(first), lastName = resolve(last, firstName);
        const a = parseCellAddress(first.address), b = parseCellAddress(last.address);
        if (!a || !b) return "#REF!";
        if (equalName(firstName, from.name) || equalName(lastName, from.name)) {
          if (!equalName(firstName, lastName)) return fail("異なるシートにまたがる範囲参照は移動できません");
          const intersects = Math.max(Math.min(a.row, b.row), source.top) <= Math.min(Math.max(a.row, b.row), source.bottom) &&
            Math.max(Math.min(a.column, b.column), source.left) <= Math.min(Math.max(a.column, b.column), source.right);
          if (intersects && !(inSource(a.row, a.column) && inSource(b.row, b.column)))
            return fail("数式が参照する範囲の一部分だけは移動できません。参照範囲全体を選択してください");
        }
        return `${rewrite(first)}:${rewrite(last, firstName)}`;
      });
      if (value !== cell.value) { changed = true; cells[address] = freezeCell(value, cell.format); }
    }
    return changed ? Object.freeze({ ...sheet, cells: Object.freeze(cells) }) : sheet;
  });
  return finish(result, workbook);
}

let nextId = 1;
export function addSheet(workbook: SpreadsheetWorkbook, suppliedName?: string): SpreadsheetWorkbook {
  if (workbook.sheets.length >= SPREADSHEET_LIMITS.sheets) return fail("シート数の上限に達しています");
  let index = 1;
  while (workbook.sheets.some(sheet => sheet.name.toLowerCase() === `sheet${index}`)) index++;
  const name = sheetName(suppliedName ?? `Sheet${index}`);
  ensureUniqueName(workbook, name);
  let id: string;
  do { id = `sheet-${++nextId}`; } while (workbook.sheets.some(sheet => sheet.id === id));
  return finish([...workbook.sheets, Object.freeze({ id, name, cells: Object.freeze({}), rowCount: 100, columnCount: 26 })], workbook);
}
function replaceSheetReferences(workbook: SpreadsheetWorkbook, name: string, replacement?: string): readonly SpreadsheetSheet[] {
  return workbook.sheets.map(sheet => {
    let changed = false;
    const cells = { ...sheet.cells };
    for (const [address, cell] of Object.entries(cells)) {
      const matches = (reference: FormulaReference) => reference.sheet?.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US");
      const value = rewriteFormulaReferences(cell.value, reference => matches(reference)
        ? replacement === undefined ? "#REF!" : `'${replacement.replaceAll("'", "''")}'!${reference.address}` : undefined,
      replacement === undefined ? (first, last) => matches(first) || matches(last) ? "#REF!" : undefined : undefined);
      if (value !== cell.value) { changed = true; cells[address] = freezeCell(value, cell.format); }
    }
    return changed ? Object.freeze({ ...sheet, cells: Object.freeze(cells) }) : sheet;
  });
}
export function renameSheet(workbook: SpreadsheetWorkbook, sheetId: string, value: string): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), name = sheetName(value);
  ensureUniqueName(workbook, name, sheetId);
  if (name === sheet.name) return workbook;
  return finish(replaceSheetReferences(workbook, sheet.name, name).map(item => item.id === sheetId ? Object.freeze({ ...item, name }) : item), workbook);
}
export function deleteSheet(workbook: SpreadsheetWorkbook, sheetId: string): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  if (workbook.sheets.length <= 1) return fail("最後のシートは削除できません");
  const sheets = replaceSheetReferences(workbook, sheet.name).filter(item => item.id !== sheetId);
  return finish(sheets, undefined, pruneImageResources(workbook.resources, sheets));
}

export function addDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawing: SpreadsheetDrawing): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), next = normalizeDrawing(drawing, sheet, workbook.resources);
  if (sheet.drawings?.some(item => item.id === next.id)) return fail("同じ ID の描画オブジェクトがあります");
  return withSheet(workbook, { ...sheet, drawings: Object.freeze([...(sheet.drawings ?? []), next]) });
}

export function updateDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawingId: string, patch: SpreadsheetDrawingPatch): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), current = sheet.drawings?.find(item => item.id === drawingId);
  if (!current) return fail("描画オブジェクトが見つかりません");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.hasOwn(patch, "id") || Object.hasOwn(patch, "type"))
    return fail("描画オブジェクトの ID と種類は変更できません");
  const next = normalizeDrawing({ ...current, ...patch } as SpreadsheetDrawing, sheet, workbook.resources);
  if (drawingsEqual(current, next)) return workbook;
  const sheets = workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze(sheet.drawings!.map(drawing => drawing.id === drawingId ? next : drawing)) }) : item);
  return finish(sheets, undefined, current.type === "image" && next.type === "image" && current.resourceId !== next.resourceId
    ? pruneImageResources(workbook.resources, sheets) : workbook.resources);
}

export function deleteDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawingId: string): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  if (!sheet.drawings?.some(item => item.id === drawingId)) return workbook;
  const sheets = workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze(sheet.drawings!.filter(drawing => drawing.id !== drawingId)) }) : item);
  return finish(sheets, undefined, pruneImageResources(workbook.resources, sheets));
}

/** Add an embedded resource and its drawing atomically; a referenced ID cannot be silently replaced. */
export function insertImage(workbook: SpreadsheetWorkbook, sheetId: string, resourceId: string,
  resource: SpreadsheetImageResource, drawing: SpreadsheetImageDrawing): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  validateObjectId(resourceId);
  if (!drawing || drawing.type !== "image" || drawing.resourceId !== resourceId) return fail("画像のリソース ID が一致していません");
  const resources = normalizeResources({ images: { ...workbook.resources?.images, [resourceId]: resource } });
  const previous = workbook.resources?.images?.[resourceId], next = resources!.images![resourceId];
  if (previous && (previous.dataUrl !== next.dataUrl || previous.name !== next.name || previous.mimeType !== next.mimeType ||
    previous.width !== next.width || previous.height !== next.height)) return fail("同じ ID の画像リソースを別の画像に置き換えることはできません");
  const normalized = normalizeDrawing(drawing, sheet, resources);
  if (sheet.drawings?.some(item => item.id === normalized.id)) return fail("同じ ID の描画オブジェクトがあります");
  return finish(workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze([...(sheet.drawings ?? []), normalized]) }) : item), undefined, resources);
}

export function setCellComments(workbook: SpreadsheetWorkbook, sheetId: string,
  input: Readonly<Record<string, SpreadsheetComment | null>>): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId);
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("コメント一覧が正しくありません");
  const comments = { ...sheet.comments };
  let changed = false;
  for (const [address, value] of Object.entries(input)) {
    const key = addressFor(sheet, address), next = value === null ? undefined : normalizeComment(value);
    const merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (next && merge && key !== cellAddress(merge.top, merge.left)) return fail("結合セルのコメントは左上のセルにだけ保存してください");
    if (commentsEqual(comments[key], next)) continue;
    changed = true;
    if (next) comments[key] = next;
    else delete comments[key];
  }
  if (!changed) return workbook;
  const ids = new Set<string>();
  for (const comment of Object.values(comments)) {
    if (ids.has(comment.id)) return fail("同じ ID のコメントがあります");
    ids.add(comment.id);
  }
  return withSheet(workbook, { ...sheet, comments: Object.freeze(comments) });
}

export function setCellComment(workbook: SpreadsheetWorkbook, sheetId: string, address: string,
  comment: SpreadsheetComment | null): SpreadsheetWorkbook {
  const sheet = getSheet(workbook, sheetId), position = mergedCellPosition(sheet, parseCellAddress(addressFor(sheet, address))!);
  return setCellComments(workbook, sheetId, { [cellAddress(position.row, position.column)]: comment });
}
