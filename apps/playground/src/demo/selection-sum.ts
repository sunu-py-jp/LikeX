import {
  cellAddress,
  getMergedRange,
  SPREADSHEET_LIMITS,
  type SpreadsheetContextMenuContext,
  type SpreadsheetMergedRange,
  type SpreadsheetSelectionRange,
} from "@likex/spreadsheet";

type Rectangle = SpreadsheetMergedRange;

function rectangle(range: SpreadsheetSelectionRange): Rectangle {
  return {
    top: Math.min(range.anchor.row, range.focus.row),
    bottom: Math.max(range.anchor.row, range.focus.row),
    left: Math.min(range.anchor.column, range.focus.column),
    right: Math.max(range.anchor.column, range.focus.column),
  };
}

/** Subtract geometry rather than expanding an entire row or column into cells. */
function subtract(range: Rectangle, excluded: Rectangle): Rectangle[] {
  const top = Math.max(range.top, excluded.top), bottom = Math.min(range.bottom, excluded.bottom);
  const left = Math.max(range.left, excluded.left), right = Math.min(range.right, excluded.right);
  if (top > bottom || left > right) return [range];
  const pieces: Rectangle[] = [];
  if (range.top < top) pieces.push({ ...range, bottom: top - 1 });
  if (bottom < range.bottom) pieces.push({ ...range, top: bottom + 1 });
  if (range.left < left) pieces.push({ top, bottom, left: range.left, right: left - 1 });
  if (right < range.right) pieces.push({ top, bottom, left: right + 1, right: range.right });
  return pieces;
}

/** The destination is excluded, and overlapping selections are only counted once. */
export function createSelectionSum(context: SpreadsheetContextMenuContext): string {
  const { target, selection, workbook } = context;
  const sheet = workbook.sheets.find(candidate => candidate.id === target.sheetId);
  if (!sheet || selection.sheetId !== target.sheetId) throw new Error("同じシートの集計範囲を選択してください。");
  const destination = getMergedRange(sheet, target) ?? {
    top: target.row, bottom: target.row, left: target.column, right: target.column,
  };
  const selected = selection.ranges?.length ? selection.ranges : [selection];
  const unique: Rectangle[] = [];
  for (const range of selected) {
    let pieces = subtract(rectangle(range), destination);
    for (const previous of unique) pieces = pieces.flatMap(piece => subtract(piece, previous));
    unique.push(...pieces);
  }
  if (!unique.length) throw new Error("数式を入れるセル以外の集計範囲も選択してください。");

  // Keep the demo within the formula engine's advertised evaluation budget.
  const cells = unique.reduce((count, range) => count + (range.bottom - range.top + 1) * (range.right - range.left + 1), 0);
  if (cells > SPREADSHEET_LIMITS.rangeCells) throw new Error("このデモでは集計範囲を10,000セル以内にしてください。");
  const formula = `=SUM(${unique.map(range => {
    const first = cellAddress(range.top, range.left), last = cellAddress(range.bottom, range.right);
    return first === last ? first : `${first}:${last}`;
  }).join(",")})`;
  if (formula.length > SPREADSHEET_LIMITS.formulaLength || unique.length * 4 > SPREADSHEET_LIMITS.formulaTokens)
    throw new Error("選択範囲が複雑すぎます。集計する範囲を少なくしてください。");
  return formula;
}
