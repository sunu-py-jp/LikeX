import { cellAddress, parseCellAddress } from "../address";
import { moveFormulaReference, rewriteFormulaReferences, type FormulaReference } from "../formula";
import { normalizeMerges, rangeContains, rangesIntersect } from "../merges";
import { SPREADSHEET_LIMITS, type SpreadsheetMoveSource, type SpreadsheetMoveTarget, type SpreadsheetWorkbook } from "../types";
import { finishWorkbook, freezeCell, getWorkbookSheet } from "./snapshot";
import { fail } from "./validation";

/** Cut/paste preserves the referenced cells, rather than applying copy-style relative offsets.
 * A partially intersected range cannot be represented as one rectangle and is rejected atomically. */
export function moveCells(workbook: SpreadsheetWorkbook, source: SpreadsheetMoveSource, destination: SpreadsheetMoveTarget): SpreadsheetWorkbook {
  const from = getWorkbookSheet(workbook, source.sheetId), to = getWorkbookSheet(workbook, destination.sheetId);
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
  return finishWorkbook(result, workbook);
}
