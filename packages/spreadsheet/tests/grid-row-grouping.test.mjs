import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({
  stdin: { contents: 'export * from "./src/model-entry"; export { cellFormatStyle, collapseSharedCellBorders } from "./src/ui/grid/cell-style";',
    resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  createSpreadsheetSession, exportSpreadsheetXlsx, importSpreadsheetXlsx, getCellFormat,
  cellFormatStyle, collapseSharedCellBorders } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main',
  rowCount: 200, columnCount: 15, cells, ...extra }] });
const line = { style: 'solid', width: 1, color: '#d1d5db' };
const command = (extra = {}) => ({ type: 'cells.writeGrid', sheetId: 'main', target: { row: 3, column: 1 },
  headers: ['担当者', '内容', '区分'], data: { type: 'rows', values: [
    ['A', '設計方針を決定する', '決定'], ['A', '実装を開始する', 'TODO'],
    ['B', 'テスト項目を整理する', 'TODO'], ['B', '検証期間を確保する', '決定'],
    ['A', '日程を調整する', 'TODO'],
  ] }, rowGrouping: { byColumns: [0] }, ...extra });
const success = result => { assert.equal(result.ok, true, result.message); return result; };
const sheet = result => success(result).workbook.sheets[0];
const borders = (after, address) => after.cells[address]?.format?.borders ?? {};

test('grouping defaults suppress only repeated key cells and draw only group and header boundaries', () => {
  const before = book(), input = command(), copied = structuredClone(input);
  const result = success(apply(before, [input])), after = sheet(result);
  assert.deepEqual(['B5', 'B6', 'B7', 'B8', 'B9'].map(address => after.cells[address].value), ['A', '', 'B', '', 'A']);
  assert.deepEqual(['D5', 'D6', 'D7', 'D8', 'D9'].map(address => after.cells[address].value), ['決定', 'TODO', 'TODO', '決定', 'TODO']);
  for (const column of ['B', 'C', 'D']) {
    assert.deepEqual(borders(after, `${column}4`), { bottom: line });
    assert.deepEqual(borders(after, `${column}5`), { top: line });
    assert.deepEqual(borders(after, `${column}6`), { bottom: line });
    assert.deepEqual(borders(after, `${column}7`), { top: line });
    assert.deepEqual(borders(after, `${column}8`), { bottom: line });
    assert.deepEqual(borders(after, `${column}9`), { top: line });
  }
  assert.deepEqual(result.results[0].layout.dataRange, { top: 4, left: 1, bottom: 8, right: 3 });
  assert.deepEqual(after.merges ?? [], []); assert.equal(after.tables, undefined);
  assert.deepEqual(input, copied); assert.deepEqual(Object.keys(before.sheets[0].cells), []);
});

test('compound keys compare exact consecutive input strings, including empty values, without sorting', () => {
  const after = sheet(apply(book(), [command({ headers: undefined, rowGrouping: { byColumns: [0, 2] },
    data: { type: 'rows', values: [['A', 'one', ''], ['A', 'two', ''], ['A', 'three', 'x'],
      ['', 'four', 'x'], ['', 'five', 'x'], ['A', 'six', 'x'], ['a', 'seven', 'x']] } })]));
  assert.deepEqual(['B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'].map(address => after.cells[address].value),
    ['A', '', 'A', '', '', 'A', 'a']);
  assert.deepEqual(['D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'].map(address => after.cells[address].value),
    ['', '', 'x', 'x', '', 'x', 'x']);
  assert.deepEqual(borders(after, 'B4'), {});
  assert.deepEqual(borders(after, 'B5'), { bottom: line });
  assert.deepEqual(borders(after, 'B8'), { bottom: line });
  assert.deepEqual(borders(after, 'B10'), { top: line });
});

test('keyDisplay all and delimited input preserve every key while styling the same boundaries', () => {
  for (const data of [{ type: 'csv', text: 'A,"line one\nline two",TODO\nA,next,TODO\nB,end,決定' },
    { type: 'tsv', text: 'A\t"line one\nline two"\tTODO\nA\tnext\tTODO\nB\tend\t決定' }]) {
    const after = sheet(apply(book(), [command({ data, rowGrouping: { byColumns: [0], keyDisplay: 'all' } })]));
    assert.equal(after.cells.B5.value, 'A'); assert.equal(after.cells.B6.value, 'A');
    assert.equal(after.cells.C5.value, 'line one\nline two');
    assert.deepEqual(borders(after, 'C6'), { bottom: line });
    assert.deepEqual(borders(after, 'C7'), { top: line });
  }
});

test('body separators and header separator have independent defaults and explicit false overrides', () => {
  const bodyOff = sheet(apply(book(), [command({ rowGrouping: { byColumns: [0], separator: false } })]));
  assert.deepEqual(borders(bodyOff, 'B4'), { bottom: line });
  assert.deepEqual(borders(bodyOff, 'B5'), { top: line });
  assert.deepEqual(borders(bodyOff, 'B6'), {}); assert.deepEqual(borders(bodyOff, 'B7'), {});
  const headerOff = sheet(apply(book(), [command({ rowGrouping: { byColumns: [0], headerSeparator: false } })]));
  assert.deepEqual(borders(headerOff, 'B4'), {}); assert.deepEqual(borders(headerOff, 'B5'), {});
  assert.deepEqual(borders(headerOff, 'B6'), { bottom: line });
});

test('custom separator, vertical borders and outline compose independently with no per-row horizontal rules', () => {
  const separator = { style: 'dashed', width: 2, color: '#123456' }, vertical = { ...line, color: '#aabbcc' };
  const outer = { ...line, width: 3 }, header = { ...line, style: 'double' };
  const after = sheet(apply(book(), [command({ rowGrouping: { byColumns: [0], separator,
    verticalBorder: { color: vertical.color }, outerBorder: { width: 3 }, headerSeparator: { style: 'double' } } })]));
  assert.deepEqual(borders(after, 'C5'), { top: header, left: vertical, right: vertical });
  assert.deepEqual(borders(after, 'B6'), { bottom: separator, right: vertical, left: outer });
  assert.deepEqual(borders(after, 'D9'), { top: separator, left: vertical, bottom: outer, right: outer });
  assert.deepEqual(borders(after, 'B4'), { bottom: header, right: vertical, top: outer, left: outer });
});

test('explicit grid restores cell edges while grouping overrides boundaries and explicit false clears axes', () => {
  const grid = { style: 'dotted', width: 2, color: '#abcdef' };
  const after = sheet(apply(book(), [command({ border: grid, rowGrouping: { byColumns: [0], separator: false,
    headerSeparator: false, verticalBorder: false, outerBorder: false } })]));
  assert.deepEqual(borders(after, 'B4'), {});
  assert.deepEqual(borders(after, 'B5'), { bottom: grid });
  assert.deepEqual(borders(after, 'C6'), { top: grid });
  assert.deepEqual(borders(after, 'C7'), { bottom: grid });
  assert.deepEqual(borders(after, 'D9'), {});
  const defaultGrid = sheet(apply(book(), [command({ rowGrouping: undefined })]));
  assert.deepEqual(borders(defaultGrid, 'C6'), { top: line, right: line, bottom: line, left: line });
  const noGrid = sheet(apply(book(), [command({ rowGrouping: undefined, border: false })]));
  assert.deepEqual(borders(noGrid, 'C6'), {});
});

test('key column numbers exclude both automatic row numbers and left header columns', () => {
  const numbered = sheet(apply(book(), [command({ rowNumbers: { start: 10 } })]));
  assert.equal(numbered.cells.B5.value, '10'); assert.equal(numbered.cells.B6.value, '11');
  assert.equal(numbered.cells.C5.value, 'A'); assert.equal(numbered.cells.C6.value, '');
  assert.deepEqual(borders(numbered, 'B6'), { bottom: line });
  assert.deepEqual(borders(numbered, 'E6'), { bottom: line });
  const left = sheet(apply(book(), [command({ rowHeaders: ['一', '二', '三', '四', '五'] })]));
  assert.equal(left.cells.B5.value, '一'); assert.equal(left.cells.B6.value, '二');
  assert.equal(left.cells.C5.value, 'A'); assert.equal(left.cells.C6.value, '');
  assert.deepEqual(borders(left, 'B6'), { bottom: line }); assert.deepEqual(borders(left, 'E6'), { bottom: line });
});

test('hierarchical merged headers receive the visible bottom rule without internal header rules', () => {
  const result = success(apply(book(), [command({ headers: ['担当者', { label: '情報', children: ['内容', '区分'] }] })]));
  const after = sheet(result);
  assert.deepEqual(borders(after, 'B4'), { bottom: line }); // Anchor of B4:B5.
  assert.deepEqual(borders(after, 'B5'), { bottom: line });
  assert.deepEqual(borders(after, 'C4'), {});
  assert.deepEqual(borders(after, 'C5'), { bottom: line });
  assert.deepEqual(borders(after, 'D5'), { bottom: line });
  assert.deepEqual(borders(after, 'C6'), { top: line });
});

test('protruding header holes stay untouched even with an outline and vertical borders', () => {
  const original = { value: 'keep', format: { background: '#ffeecc', borders: { top: { color: '#ff0000' } } } };
  const before = book({ B4: original });
  const after = sheet(apply(before, [command({ headers: ['担当者', { label: '情報', children: ['内容', '区分'] }],
    headerLayout: 'protruding', rowGrouping: { byColumns: [0], outerBorder: {}, verticalBorder: {} }, onConflict: 'error' })]));
  assert.deepEqual(after.cells.B4, before.sheets[0].cells.B4); assert.equal(after.cells.B5.value, '担当者');
  assert.deepEqual(borders(after, 'B5').bottom, line);
});

test('explicit corner borders take precedence over group decorations and empty corners remain unmerged', () => {
  const cornerBorder = { ...line, color: '#ff0000', width: 3 };
  const after = sheet(apply(book(), [command({ rowHeaders: ['一', '二', '三', '四', '五'],
    corner: { border: { color: '#ff0000', width: 3 } },
    rowGrouping: { byColumns: [0], outerBorder: {}, verticalBorder: {} } })]));
  assert.equal(after.cells.B4.value, '');
  assert.deepEqual(borders(after, 'B4'), { top: cornerBorder, right: cornerBorder, bottom: cornerBorder, left: cornerBorder });
  assert.deepEqual(borders(after, 'C4').left, cornerBorder);
  assert.deepEqual(borders(after, 'B5').top, cornerBorder);
  assert.deepEqual(after.merges ?? [], []);
});

test('explicit corner borders synchronize adjacent merged headers for single-line rendering and XLSX', async () => {
  for (const style of ['solid', 'none']) {
    const cornerBorder = { style, width: 3, color: '#ff0000' };
    const result = success(apply(book(), [command({
      headers: ['担当者', { label: '情報', children: ['内容', '区分'] }],
      rowHeaders: [{ label: '前半', children: ['一', '二'] }, { label: '中盤', children: ['三', '四'] }, '五'],
      corner: { label: '区分', border: cornerBorder },
      rowGrouping: { byColumns: [0], outerBorder: {}, verticalBorder: {} },
    })]));
    const original = sheet(result);
    for (const [address, edge] of [['D4', 'left'], ['D5', 'left'], ['B6', 'top'], ['C6', 'top']])
      assert.deepEqual(borders(original, address)[edge], cornerBorder, address);
    const neighbour = (row, column) => getCellFormat(original, row, column);
    const rightStyle = collapseSharedCellBorders(cellFormatStyle(original.cells.D4.format, ''),
      { top: 3, left: 3, bottom: 4, right: 3 }, neighbour);
    const belowStyle = collapseSharedCellBorders(cellFormatStyle(original.cells.B6.format, ''),
      { top: 5, left: 1, bottom: 6, right: 1 }, neighbour);
    assert.equal(rightStyle.borderLeft, style === 'none' ? undefined : 0);
    assert.equal(belowStyle.borderTop, style === 'none' ? undefined : 0);
    const restored = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
    assert.deepEqual(restored.warnings, []);
    const after = restored.workbook.sheets[0];
    for (const [row, column, edge] of [[3, 3, 'left'], [4, 3, 'left'], [5, 1, 'top'], [5, 2, 'top']]) {
      const actual = getCellFormat(after, row, column)?.borders?.[edge];
      if (style === 'none') assert.ok(!actual || actual.style === 'none');
      else assert.deepEqual({ ...actual, color: actual.color.toLowerCase() }, cornerBorder);
    }
  }
});

test('blank corners retain their border-free default under grouped header, vertical and outline decorations', () => {
  for (const corner of [undefined, { label: null }, { label: '  ' }]) {
    const after = sheet(apply(book(), [command({ corner, rowHeaders: ['一', '二', '三', '四', '五'],
      rowGrouping: { byColumns: [0], outerBorder: {}, verticalBorder: {} } })]));
    assert.equal(after.cells.B4.value, ''); assert.deepEqual(borders(after, 'B4'), {});
    assert.deepEqual(borders(after, 'B5').top, line); assert.deepEqual(after.merges ?? [], []);
  }
});

test('left headers may span one group but a visible separator cannot cross a merged header', () => {
  const aligned = command({ rowHeaders: [{ label: '前半', children: ['一', '二'] }, { label: '中盤', children: ['三', '四'] }, '五'] });
  const after = sheet(apply(book(), [aligned]));
  assert.deepEqual(borders(after, 'B5'), { top: line, bottom: line });
  const crossing = command({ rowHeaders: [{ label: '前半', children: ['一', '二', '三'] }, '四', '五'] });
  const before = book(), serialized = serializeWorkbook(before), failed = apply(before, [crossing]);
  assert.equal(failed.ok, false); assert.match(failed.message, /区切り線.*結合セル/);
  assert.equal(serializeWorkbook(before), serialized);
  success(apply(before, [{ ...crossing, rowGrouping: { byColumns: [0], separator: false } }]));
});

test('skip conflicts cannot change grouping keys but may preserve unrelated data cells', () => {
  for (const address of ['B5', 'B6', 'B7']) {
    const before = book({ [address]: { value: 'existing' } }), serialized = serializeWorkbook(before);
    const result = apply(before, [command({ onConflict: 'skip' })]);
    assert.equal(result.ok, false); assert.equal(result.code, 'WRITE_CONFLICT');
    assert.equal(serializeWorkbook(before), serialized);
  }
  const before = book({ C6: { value: 'keep', format: { italic: true } } });
  const result = success(apply(before, [command({ onConflict: 'skip' })]));
  assert.deepEqual(result.results[0].write.skippedAddresses, ['C6']);
  assert.deepEqual(sheet(result).cells.C6, before.sheets[0].cells.C6);
});

test('invalid grouping and border configurations fail atomically', () => {
  const bad = [null, false, {}, { byColumns: [] }, { byColumns: [0, 0] }, { byColumns: [-1] }, { byColumns: [3] },
    { byColumns: [0.5] }, { byColumns: [NaN] }, { byColumns: [Infinity] }, { byColumns: ['0'] }, { byColumns: Array(1) },
    { byColumns: [0], keyDisplay: null }, { byColumns: [0], keyDisplay: 'merged' }, { byColumns: [0], extra: true }];
  for (const name of ['separator', 'headerSeparator', 'verticalBorder', 'outerBorder'])
    for (const value of [null, true, 'solid', [], { extra: true }, { width: NaN }, { width: Infinity }, { width: 4 }, { style: 'bad' }])
      bad.push({ byColumns: [0], [name]: value });
  const before = book({ A1: { value: 'keep' } }), serialized = serializeWorkbook(before);
  for (const rowGrouping of bad) {
    const result = apply(before, [command({ rowGrouping })]);
    assert.equal(result.ok, false, JSON.stringify(rowGrouping)); assert.equal(result.workbook, undefined);
    assert.equal(serializeWorkbook(before), serialized);
  }
  for (const border of [null, true, { unsupported: true }]) assert.equal(apply(before, [command({ border })]).ok, false);
});

test('input character limits count suppressed labels and the combined header and body', () => {
  const key = 'a'.repeat(100_000);
  for (const count of [104, 106]) {
    const result = apply(book(), [command({ headers: [key], data: { type: 'rows', values: Array.from({ length: count }, () => [key]) } })]);
    assert.equal(result.ok, false); assert.match(result.message, /10 Mi文字/);
  }
});

test('headerless grouping starts at the target and supports a single group and header-only output', () => {
  const after = sheet(apply(book(), [command({ headers: undefined, data: { type: 'rows', values: [['A', 'one'], ['A', 'two']] } })]));
  assert.equal(after.cells.B4.value, 'A'); assert.equal(after.cells.C4.value, 'one');
  assert.equal(after.cells.B5.value, ''); assert.deepEqual(borders(after, 'B4'), {}); assert.deepEqual(borders(after, 'B5'), {});
  const headers = sheet(apply(book(), [command({ data: { type: 'rows', values: [] } })]));
  assert.equal(headers.cells.B4.value, '担当者'); assert.deepEqual(borders(headers, 'B4'), {});
});

test('grouped writes preserve unrelated formatting and round-trip as ordinary cells in SPON and XLSX', async () => {
  const before = book({ C5: { value: '', format: { wrap: true, verticalAlign: 'top', background: '#ffeecc' } } });
  const result = success(apply(before, [command()])), serialized = serializeWorkbook(result.workbook);
  const native = parseWorkbook(serialized);
  assert.equal(serializeWorkbook(native), serialized); assert.equal(native.sheets[0].cells.C5.format.wrap, true);
  const restored = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(native));
  assert.deepEqual(restored.warnings, []);
  const after = restored.workbook.sheets[0];
  assert.equal(after.tables, undefined); assert.deepEqual(after.merges ?? [], []);
  for (const [address, row, column] of [['B5', 4, 1], ['B6', 5, 1], ['C5', 4, 2], ['D7', 6, 3], ['D9', 8, 3]]) {
    assert.equal(after.cells[address]?.value ?? '', native.sheets[0].cells[address].value, address);
    const actual = getCellFormat(after, row, column)?.borders ?? {}, expected = borders(native.sheets[0], address);
    assert.deepEqual(Object.fromEntries(Object.entries(actual).map(([edge, value]) => [edge, { ...value, color: value.color?.toLowerCase() }])), expected, address);
  }
  assert.equal(after.cells.C5.format.wrap, true); assert.equal(after.cells.C5.format.verticalAlign, 'top');
});

test('grouped hierarchical header and left-header merged edges survive XLSX round-trip', async () => {
  const result = success(apply(book(), [command({
    headers: ['担当者', { label: '情報', children: ['内容', '区分'] }],
    rowHeaders: [{ label: '前半', children: ['一', '二'] }, { label: '中盤', children: ['三', '四'] }, '五'],
  })]));
  const original = sheet(result), restored = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.deepEqual(restored.warnings, []);
  const after = restored.workbook.sheets[0];
  assert.deepEqual(after.merges, original.merges);
  // D4:D5 is the vertically merged key header; B6:B7 spans exactly the first group.
  for (const [address, row, column] of [['D4', 3, 3], ['D5', 4, 3], ['B6', 5, 1], ['B7', 6, 1], ['C7', 6, 2]]) {
    const actual = getCellFormat(after, row, column)?.borders ?? {};
    assert.deepEqual(Object.fromEntries(Object.entries(actual).map(([edge, value]) => [edge,
      { ...value, color: value.color?.toLowerCase() }])), borders(original, address), address);
  }
  assert.equal(after.cells.D6.value, 'A'); assert.equal(after.cells.D7?.value ?? '', '');
});

test('a grouped command participates in one normal undo and redo history entry', () => {
  const session = createSpreadsheetSession(book());
  const before = session.getWorkbook();
  const result = session.execute(command());
  assert.equal(result.ok, true, result.message);
  const written = serializeWorkbook(session.getWorkbook());
  assert.deepEqual(session.getHistoryState(), { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 });
  session.undo(); assert.equal(serializeWorkbook(session.getWorkbook()), serializeWorkbook(before));
  session.redo(); assert.equal(serializeWorkbook(session.getWorkbook()), written);
});

test('grouped output and shifted existing cells and references survive XLSX after inserting rows and columns', async () => {
  const before = book({ A1: { value: '=B4' }, B4: { value: 'existing', format: { bold: true } } });
  const result = success(apply(before, [command({ insert: 'both' })]));
  assert.equal(sheet(result).cells.E10.value, 'existing');
  assert.equal(sheet(result).cells.A1.value, '=E10');
  const restored = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.deepEqual(restored.warnings, []);
  const after = restored.workbook.sheets[0];
  assert.equal(after.cells.E10.value, 'existing'); assert.equal(after.cells.E10.format.bold, true);
  assert.equal(after.cells.A1.value, '=E10'); assert.equal(after.cells.B5.value, 'A');
  assert.equal(after.cells.B6?.value ?? '', ''); assert.equal(after.cells.B7.value, 'B');
  for (const actual of [after.cells.C6.format.borders.bottom, after.cells.C7.format.borders.top])
    assert.deepEqual({ ...actual, color: actual.color.toLowerCase() }, line);
  assert.equal(after.cells.C5.format.borders.bottom, undefined);
});
