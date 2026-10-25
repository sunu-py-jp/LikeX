import type { SpreadsheetCellGridWriteOptions, SpreadsheetGridLayout } from "../../api/table-commands";
import { cellAddress, parseCellAddress } from "../address";
import { getCellFormat } from "../format-ranges";
import { normalizeMerges, rangesIntersect } from "../merges";
import { tableDataRows } from "../tables/data";
import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "../workbook/snapshot";
import { normalizeCellFormat, validateCellValue } from "../workbook/validation";
import { filterCellValueWrites, WriteConflictError } from "../workbook/write-conflicts";
import { gridCorner, gridHeaderAxis, gridHeaderLayout, gridHeaderStyle, type GridHeaderAxis, type GridHeaderNode } from "./headers";
import { applyGridGroupingBorders, defaultGridBorder, gridBorder, gridRowGrouping } from "./grouping";

export type SpreadsheetGridWritePlan = Readonly<{
  range: SpreadsheetMergedRange;
  values: Readonly<Record<string, string>>;
  formats: Readonly<Record<string, SpreadsheetCellFormat>>;
  layout: SpreadsheetGridLayout;
}>;
const plans = new WeakMap<SpreadsheetGridWritePlan, { sheet: SpreadsheetSheet; options: SpreadsheetCellGridWriteOptions; groupingKeys: readonly string[] }>();
const rangeKey = (range: SpreadsheetMergedRange) => `${range.top}:${range.left}:${range.bottom}:${range.right}`;
const frozenRange = (top: number, left: number, bottom: number, right: number) => Object.freeze({ top, left, bottom, right });

function resolveGridInput(options: SpreadsheetCellGridWriteOptions) {
  if (!options || typeof options !== "object") throw new Error("表の設定が正しくありません");
  let topAxis = gridHeaderAxis(options.headers);
  const leftAxis = gridHeaderAxis(options.rowHeaders);
  const topLayout = gridHeaderLayout(options.headerLayout), leftLayout = gridHeaderLayout(options.rowHeaderLayout);
  const headerStyle = gridHeaderStyle(options.headerStyle), rowStyle = gridHeaderStyle(options.rowHeaderStyle);
  const rows = tableDataRows(options.data, topAxis?.leaves);
  const grouping = gridRowGrouping(options.rowGrouping, rows, topAxis?.leaves ?? rows[0]?.length ?? 0);
  let numberStart: number | undefined;
  if (options.rowNumbers !== undefined && options.rowNumbers !== false) {
    if (!topAxis || leftAxis) throw new Error("連番列には上見出しが必要です。左見出しとは併用できません");
    if (!options.rowNumbers || typeof options.rowNumbers !== "object" || Array.isArray(options.rowNumbers))
      throw new Error("連番列の設定が正しくありません");
    numberStart = options.rowNumbers.start ?? 1;
    if (!Number.isSafeInteger(numberStart) || !Number.isSafeInteger(numberStart + Math.max(0, rows.length - 1)))
      throw new Error("連番は安全な整数の範囲で指定してください");
    const numberHeader = gridHeaderAxis([options.rowNumbers.header ?? "No."])!;
    topAxis = Object.freeze({ roots: Object.freeze([...numberHeader.roots, ...topAxis.roots]), depth: topAxis.depth, leaves: topAxis.leaves + 1 });
  }
  if (leftAxis && leftAxis.leaves !== rows.length) throw new Error("左見出しの末端数を明細の行数と一致させてください");
  if (options.corner !== undefined && (!topAxis || !leftAxis)) throw new Error("cornerには上見出しと左見出しの両方が必要です");
  const corner = gridCorner(options.corner);
  const bodyWidth = topAxis?.leaves ?? rows[0]?.length ?? 0;
  const headerHeight = topAxis?.depth ?? 0, headerWidth = leftAxis?.depth ?? 0;
  const height = headerHeight + rows.length, width = headerWidth + bodyWidth;
  if (!height || !width) throw new Error("表には1セル以上の見出しまたは明細を指定してください");
  if (height * width > SPREADSHEET_LIMITS.clipboardCells) throw new Error("見出しと連番を含む表全体は10,000セル以内で指定してください");
  return { topAxis, leftAxis, topLayout, leftLayout, headerStyle, rowStyle, rows, grouping, numberStart, corner, headerHeight, headerWidth, height, width };
}

/** Determine the insertion footprint without checking collisions in the sheet that will be shifted. */
export function getSpreadsheetGridWriteDimensions(options: SpreadsheetCellGridWriteOptions): Readonly<{ height: number; width: number }> {
  const { height, width } = resolveGridInput(options);
  return Object.freeze({ height, width });
}

/** Resolve the complete cell layout without changing the workbook. Holes in protruding headers remain absent. */
export function prepareSpreadsheetGridWrite(sheet: SpreadsheetSheet, options: SpreadsheetCellGridWriteOptions): SpreadsheetGridWritePlan {
  const { topAxis, leftAxis, topLayout, leftLayout, headerStyle, rowStyle, rows, grouping, numberStart, corner,
    headerHeight, headerWidth, height, width } = resolveGridInput(options);
  const { target } = options;
  if (!target || !Number.isInteger(target.row) || !Number.isInteger(target.column) || target.row < 0 || target.column < 0)
    throw new Error("表の開始位置は0始まりの行・列で指定してください");
  const range = frozenRange(target.row, target.column, target.row + height - 1, target.column + width - 1);
  if (range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) throw new Error("表がシートの範囲を超えています。行・列が足りません");
  const border = gridBorder(options.border, grouping ? false : defaultGridBorder);
  const gridBorders = normalizeCellFormat({ borders: border === false ? {} : { top: border, bottom: border, left: border, right: border } })!.borders!;
  const values: Record<string, string> = Object.create(null), formats: Record<string, SpreadsheetCellFormat> = Object.create(null);
  const headerRanges: SpreadsheetMergedRange[] = [], rowHeaderRanges: SpreadsheetMergedRange[] = [], merges: SpreadsheetMergedRange[] = [];
  let characters = 0;
  const fill = (area: SpreadsheetMergedRange, value: string, style?: SpreadsheetCellFormat, borders = gridBorders, merge = true) => {
    const format = normalizeCellFormat({ ...style, borders })!;
    for (let row = area.top; row <= area.bottom; row++) for (let column = area.left; column <= area.right; column++) {
      const address = cellAddress(row, column), cellValue = row === area.top && column === area.left ? value : "";
      if (Object.hasOwn(values, address)) throw new Error("表の配置範囲が重複しています");
      values[address] = cellValue; formats[address] = format; characters += cellValue.length;
    }
    if (merge && (area.top !== area.bottom || area.left !== area.right)) merges.push(area);
  };
  const placeAxis = (axis: GridHeaderAxis, horizontal: boolean) => {
    const layout = horizontal ? topLayout : leftLayout;
    const baseStyle = horizontal ? headerStyle : normalizeCellFormat({ ...headerStyle, ...rowStyle });
    const pending: { node: GridHeaderNode; level: number; leaf: number }[] = [];
    let offset = 0;
    for (const node of axis.roots) { pending.push({ node, level: layout === "protruding" ? axis.depth - node.depth : 0, leaf: offset }); offset += node.leaves; }
    pending.reverse();
    while (pending.length) {
      const { node, level, leaf } = pending.pop()!;
      const endLevel = node.children.length ? level : axis.depth - 1;
      const area = horizontal
        ? frozenRange(target.row + level, target.column + headerWidth + leaf, target.row + endLevel, target.column + headerWidth + leaf + node.leaves - 1)
        : frozenRange(target.row + headerHeight + leaf, target.column + level, target.row + headerHeight + leaf + node.leaves - 1, target.column + endLevel);
      (horizontal ? headerRanges : rowHeaderRanges).push(area);
      fill(area, node.value, normalizeCellFormat({ ...baseStyle, ...node.style }));
      let childOffset = leaf + node.leaves;
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]; childOffset -= child.leaves;
        pending.push({ node: child, level: level + 1, leaf: childOffset });
      }
    }
  };
  if (topAxis) placeAxis(topAxis, true);
  if (leftAxis) placeAxis(leftAxis, false);
  const cornerRange = topAxis && leftAxis ? frozenRange(target.row, target.column, target.row + headerHeight - 1, target.column + headerWidth - 1) : undefined;
  if (cornerRange) {
    const cornerBorder = corner.border === undefined ? undefined : { ...defaultGridBorder, ...(border === false ? undefined : border), ...corner.border };
    const cornerBorders = cornerBorder ? normalizeCellFormat({ borders: { top: cornerBorder, bottom: cornerBorder, left: cornerBorder, right: cornerBorder } })!.borders!
      : corner.value ? gridBorders : Object.freeze({});
    fill(cornerRange, corner.value, normalizeCellFormat({ ...(corner.value ? headerStyle : undefined), ...corner.style }), cornerBorders, corner.merge);
  }
  const dataRange = rows.length ? frozenRange(target.row + headerHeight, target.column + headerWidth, range.bottom, range.right) : undefined;
  const groupingKeys: string[] = [];
  for (let row = 0; row < rows.length; row++) {
    const items = numberStart === undefined ? rows[row] : [String(numberStart + row), ...rows[row]];
    for (let column = 0; column < items.length; column++) {
      const r = target.row + headerHeight + row, c = target.column + headerWidth + column;
      const raw = validateCellValue(items[column]), keyColumn = column - (numberStart === undefined ? 0 : 1);
      const groupKey = grouping?.columns.has(keyColumn);
      if (groupKey) groupingKeys.push(cellAddress(r, c));
      const value = grouping && groupKey && grouping.firstOnly && !grouping.starts[row] ? "" : raw;
      fill(frozenRange(r, c, r, c), value);
      // Suppressing duplicate labels must not reduce the accepted input-character count.
      characters += raw.length - value.length;
    }
  }
  if (characters > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("見出しと連番を含む表全体は10 Mi文字以内で指定してください");
  if (grouping) applyGridGroupingBorders(formats, range, headerHeight, merges, grouping,
    corner.border !== undefined || !corner.value ? cornerRange : undefined, corner.border !== undefined);
  const plannedMerges = new Set(merges.map(rangeKey));
  for (const existing of sheet.merges ?? []) {
    if (!rangesIntersect(existing, range) || plannedMerges.has(rangeKey(existing))) continue;
    for (let row = Math.max(existing.top, range.top); row <= Math.min(existing.bottom, range.bottom); row++)
      for (let column = Math.max(existing.left, range.left); column <= Math.min(existing.right, range.right); column++)
        if (Object.hasOwn(values, cellAddress(row, column))) throw new Error("表の書き込み先には配置と一致しない結合セルを含められません");
  }
  if (merges.some(merge => sheet.tables?.some(table => rangesIntersect(merge, table.range))))
    throw new Error("既存のテーブルと重なる位置には見出しを結合できません");
  const layout: SpreadsheetGridLayout = Object.freeze({ ...(dataRange ? { dataRange } : {}), headerRanges: Object.freeze(headerRanges),
    rowHeaderRanges: Object.freeze(rowHeaderRanges), ...(cornerRange ? { cornerRange } : {}), merges: Object.freeze(merges) });
  const plan = Object.freeze({ range, values: Object.freeze(values), formats: Object.freeze(formats), layout });
  plans.set(plan, { sheet, options, groupingKeys: Object.freeze(groupingKeys) });
  return plan;
}

/** Apply values, formats and merges as one immutable transaction, retaining unrelated cell metadata. */
export function writeSpreadsheetGrid(workbook: SpreadsheetWorkbook, options: SpreadsheetCellGridWriteOptions, prepared?: SpreadsheetGridWritePlan) {
  const sheet = getWorkbookSheet(workbook, options.sheetId), cached = prepared ? plans.get(prepared) : undefined;
  const plan = prepared && cached?.sheet === sheet && cached.options === options ? prepared : prepareSpreadsheetGridWrite(sheet, options);
  const filtered = filterCellValueWrites(sheet, plan.values, options.onConflict);
  const skipped = new Set(filtered.skippedAddresses);
  const skippedKeys = plans.get(plan)!.groupingKeys.filter(address => skipped.has(address));
  if (skippedKeys.length) throw new WriteConflictError(skippedKeys);
  for (const merge of plan.layout.merges) {
    const conflicts: string[] = [];
    for (let row = merge.top; row <= merge.bottom; row++) for (let column = merge.left; column <= merge.right; column++) {
      const address = cellAddress(row, column);
      if (skipped.has(address)) conflicts.push(address);
      if ((row !== merge.top || column !== merge.left) && sheet.comments?.[address])
        throw new Error("見出しを結合すると左上以外のコメントが隠れるため、書き込めません");
    }
    if (conflicts.length) throw new WriteConflictError(conflicts);
  }
  const cells = { ...sheet.cells };
  let changedCount = 0;
  for (const [address, value] of Object.entries(filtered.values)) {
    const previous = cells[address], position = parseCellAddress(address)!;
    if ((previous?.value ?? "") !== value) changedCount++;
    const format = normalizeCellFormat({ ...getCellFormat(sheet, position.row, position.column), ...plan.formats[address] });
    cells[address] = freezeCell(value, format, previous?.validation);
  }
  const existing = new Set((sheet.merges ?? []).map(rangeKey));
  const additions = plan.layout.merges.filter(merge => !existing.has(rangeKey(merge)));
  const next = replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells),
    ...(additions.length ? { merges: normalizeMerges([...(sheet.merges ?? []), ...additions], sheet) } : {}) });
  return Object.freeze({ workbook: next, range: plan.range, layout: plan.layout,
    write: Object.freeze({ changedCount, skippedCount: filtered.skippedAddresses.length, skippedAddresses: filtered.skippedAddresses }) });
}
