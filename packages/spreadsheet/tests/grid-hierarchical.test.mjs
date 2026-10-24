import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({
  stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { applySpreadsheetCommands: apply, normalizeWorkbook, calculateWorkbook,
  serializeWorkbook, parseWorkbook, createSpreadsheetSession } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main',
  rowCount: 30, columnCount: 15, cells, ...extra }] });
const write = (extra = {}) => ({ type: 'cells.writeGrid', sheetId: 'main', target: { row: 1, column: 1 },
  headers: ['コード', '商品名', '区分', { label: '売上', children: ['4月', '5月'] }],
  data: { type: 'rows', values: [['A001', '商品A', '食品', '100', '120'], ['A002', '商品B', '雑貨', '200', '250']] },
  ...extra });
const matrix = (extra = {}) => write({
  headers: [{ label: '2025年', children: ['売上', '利益'] }, '備考'],
  rowHeaders: [{ label: '東日本', children: ['東京', '横浜'] }, '大阪'],
  corner: { label: '地域別実績' },
  data: { type: 'rows', values: [['1200', '240', '本店'], ['860', '150', ''], ['1320', '270', '支店']] },
  ...extra,
});
const succeeded = result => { assert.equal(result.ok, true, result.message); return result; };
const sheet = result => succeeded(result).workbook.sheets[0];
const range = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const sortedRanges = ranges => (ranges ?? []).map(item => JSON.stringify(item)).sort();
const assertMerges = (actual, expected) => assert.deepEqual(sortedRanges(actual), sortedRanges(expected));

test('ordinary table columns and grouped matrix columns share one ordered body and placement receipt', () => {
  const before = book({}, { rowHeights: { 1: 34 }, columnWidths: { 1: 110 } });
  const result = succeeded(apply(before, [write()])), after = sheet(result);
  assert.equal(after.cells.B2.value, 'コード'); assert.equal(after.cells.C2.value, '商品名');
  assert.equal(after.cells.D2.value, '区分'); assert.equal(after.cells.E2.value, '売上');
  assert.equal(after.cells.E3.value, '4月'); assert.equal(after.cells.F3.value, '5月');
  assert.deepEqual(['B4', 'C4', 'D4', 'E4', 'F4'].map(address => after.cells[address].value),
    ['A001', '商品A', '食品', '100', '120']);
  assertMerges(after.merges, [range(1, 1, 2, 1), range(1, 2, 2, 2), range(1, 3, 2, 3), range(1, 4, 1, 5)]);
  assert.deepEqual(result.results[0].range, range(1, 1, 4, 5));
  assert.deepEqual(result.results[0].layout.dataRange, range(3, 1, 4, 5));
  assert.deepEqual(result.results[0].placement, { nextRow: 5, nextColumn: 6 });
  assert.deepEqual(after.rowHeights, before.sheets[0].rowHeights);
  assert.deepEqual(after.columnWidths, before.sheets[0].columnWidths);
  assert.equal(after.tables, undefined); assert.deepEqual(Object.keys(before.sheets[0].cells), []);
});

test('hierarchical row and column headers combine with a merged corner and unequal-depth leaves', () => {
  const result = succeeded(apply(book(), [matrix()])), after = sheet(result), layout = result.results[0].layout;
  assert.equal(after.cells.B2.value, '地域別実績'); assert.equal(after.cells.D2.value, '2025年');
  assert.equal(after.cells.D3.value, '売上'); assert.equal(after.cells.E3.value, '利益');
  assert.equal(after.cells.F2.value, '備考'); assert.equal(after.cells.B4.value, '東日本');
  assert.equal(after.cells.C4.value, '東京'); assert.equal(after.cells.C5.value, '横浜');
  assert.equal(after.cells.B6.value, '大阪'); assert.equal(after.cells.D4.value, '1200');
  assert.equal(after.cells.F6.value, '支店');
  assertMerges(after.merges, [range(1, 1, 2, 2), range(1, 3, 1, 4), range(1, 5, 2, 5),
    range(3, 1, 4, 1), range(5, 1, 5, 2)]);
  assert.deepEqual(layout.dataRange, range(3, 3, 5, 5));
  assert.deepEqual(layout.cornerRange, range(1, 1, 2, 2));
  assertMerges(layout.merges, after.merges);
  assert.equal(layout.headerRanges.length, 4); assert.equal(layout.rowHeaderRanges.length, 4);
});

test('three-level branches preserve leaf order and vertically merge the shallow branch leaves', () => {
  const result = succeeded(apply(book(), [write({
    headers: [{ label: '2026年', children: [{ label: '上期', children: ['売上', '利益'] }, '予算'] }, '備考'],
    data: { type: 'rows', values: [['100', '20', '150', '計画']] },
  })]));
  const after = sheet(result);
  assert.equal(after.cells.B2.value, '2026年'); assert.equal(after.cells.B3.value, '上期');
  assert.equal(after.cells.B4.value, '売上'); assert.equal(after.cells.C4.value, '利益');
  assert.equal(after.cells.D3.value, '予算'); assert.equal(after.cells.E2.value, '備考');
  assert.deepEqual(['B5', 'C5', 'D5', 'E5'].map(address => after.cells[address].value), ['100', '20', '150', '計画']);
  assertMerges(after.merges, [range(1, 1, 1, 3), range(2, 1, 2, 2), range(2, 3, 3, 3), range(1, 4, 3, 4)]);
});

test('row-only and headerless grids accept the existing delimited body formats', () => {
  const leftOnly = succeeded(apply(book(), [write({ headers: undefined,
    rowHeaders: [{ label: '商品', children: ['名前', '価格'] }, '在庫'],
    data: { type: 'csv', text: '"商品,A",通常\r\n1200,税込\r\n50,個' },
  })]));
  assert.equal(sheet(leftOnly).cells.B2.value, '商品'); assert.equal(sheet(leftOnly).cells.C2.value, '名前');
  assert.equal(sheet(leftOnly).cells.D2.value, '商品,A'); assert.equal(sheet(leftOnly).cells.B4.value, '在庫');
  assert.deepEqual(leftOnly.results[0].layout.dataRange, range(1, 3, 3, 4));
  assertMerges(sheet(leftOnly).merges, [range(1, 1, 2, 1), range(3, 1, 3, 2)]);
  const noHeaders = succeeded(apply(book(), [write({ headers: undefined, data: { type: 'tsv', text: 'a\t1\nb\t2' } })]));
  assert.equal(sheet(noHeaders).cells.B2.value, 'a'); assert.equal(sheet(noHeaders).cells.C3.value, '2');
  assert.deepEqual(noHeaders.results[0].layout.dataRange, range(1, 1, 2, 2));
  assert.deepEqual(noHeaders.results[0].layout.headerRanges, []);
  assert.deepEqual(noHeaders.results[0].layout.rowHeaderRanges, []);
  assert.equal(noHeaders.results[0].layout.cornerRange, undefined);
});

test('header styles use axis defaults and per-node overrides without changing body formatting', () => {
  const border = { style: 'dashed', width: 2, color: '#667788' };
  const result = succeeded(apply(book({ D4: { value: '', format: { italic: true, background: '#abcdef' } } }), [matrix({
    headers: [{ label: '2025年', style: { background: '#123456' }, children: ['売上', '利益'] }, '備考'],
    rowHeaders: [{ label: '東日本', style: { color: '#111111' }, children: ['東京', '横浜'] }, '大阪'],
    headerStyle: { background: '#217346', color: '#ffffff' }, rowHeaderStyle: { background: '#e2f0d9' },
    corner: { label: '地域別実績', style: { background: '#eeeeee', color: '#222222' } }, border,
  })]));
  const after = sheet(result);
  assert.equal(after.cells.D2.format.background, '#123456'); assert.equal(after.cells.D2.format.color, '#ffffff');
  assert.equal(after.cells.D3.format.background, '#217346');
  assert.equal(after.cells.B4.format.color, '#111111'); assert.equal(after.cells.B4.format.background, '#e2f0d9');
  assert.equal(after.cells.C4.format.color, '#ffffff'); assert.equal(after.cells.B2.format.background, '#eeeeee');
  assert.equal(after.cells.D4.format.italic, true); assert.equal(after.cells.D4.format.background, '#abcdef');
  assert.deepEqual(after.cells.F6.format.borders, { top: border, right: border, bottom: border, left: border });
});

test('omitted, null and blank corner labels leave unmerged empty cells without automatic header colors or borders', () => {
  const border = { style: 'dashed', width: 2, color: '#667788' };
  for (const corner of [undefined, {}, { label: undefined }, { label: null }, { label: '' }, { label: ' \t\n\u3000' }]) {
    const before = book(), command = matrix({ corner, headerStyle: { background: '#217346', color: '#ffffff' }, border });
    const input = structuredClone(command), result = succeeded(apply(before, [command])), after = sheet(result);
    for (const address of ['B2', 'C2', 'B3', 'C3']) {
      assert.equal(after.cells[address]?.value ?? '', '', address);
      assert.equal(after.cells[address]?.format?.background, undefined, address);
      assert.equal(after.cells[address]?.format?.color, undefined, address);
      assert.deepEqual(after.cells[address]?.format?.borders ?? {}, {}, address);
    }
    assert.deepEqual(result.results[0].layout.cornerRange, range(1, 1, 2, 2));
    assertMerges(after.merges, [range(1, 3, 1, 4), range(1, 5, 2, 5), range(3, 1, 4, 1), range(5, 1, 5, 2)]);
    assertMerges(result.results[0].layout.merges, after.merges);
    assert.deepEqual(after.cells.D2.format.borders.left, border);
    assert.deepEqual(after.cells.B4.format.borders.top, border);
    assert.equal(after.cells.D2.format.background, '#217346');
    assert.equal(after.cells.B4.format.color, '#ffffff');
    assert.deepEqual(command, input); assert.deepEqual(Object.keys(before.sheets[0].cells), []);
  }
});

test('an empty corner accepts explicit borders and colors without inheriting unspecified header colors', () => {
  const border = { style: 'dashed', width: 2, color: '#667788' };
  for (const patch of [{}, { color: '#aa0000' }]) {
    const result = succeeded(apply(book(), [matrix({ corner: { label: null, border: patch }, border,
      headerStyle: { background: '#217346', color: '#ffffff' } })])), after = sheet(result);
    const expected = { ...border, ...patch };
    for (const address of ['B2', 'C2', 'B3', 'C3']) {
      assert.equal(after.cells[address].value, '');
      assert.equal(after.cells[address].format.background, undefined);
      assert.equal(after.cells[address].format.color, undefined);
      assert.deepEqual(after.cells[address].format.borders, { top: expected, right: expected, bottom: expected, left: expected });
    }
    assert.ok(!after.merges.some(merge => JSON.stringify(merge) === JSON.stringify(range(1, 1, 2, 2))));
  }
  const defaultBorder = { style: 'solid', width: 1, color: '#d1d5db' };
  const explicitDefault = sheet(apply(book(), [matrix({ corner: { border: {} } })]));
  assert.deepEqual(explicitDefault.cells.B2.format.borders,
    { top: defaultBorder, right: defaultBorder, bottom: defaultBorder, left: defaultBorder });
  const colored = sheet(apply(book(), [matrix({ corner: { style: { background: '#ffeecc' } },
    headerStyle: { background: '#217346', color: '#ffffff' } })]));
  assert.equal(colored.cells.B2.value, ''); assert.equal(colored.cells.B2.format.background, '#ffeecc');
  assert.equal(colored.cells.B2.format.color, undefined); assert.deepEqual(colored.cells.B2.format.borders, {});
  assert.ok(!colored.merges.some(merge => JSON.stringify(merge) === JSON.stringify(range(1, 1, 2, 2))));
});

test('corner merge explicitly overrides the label-based default without changing the corner footprint', () => {
  const cornerRange = range(1, 1, 2, 2);
  for (const corner of [{ merge: true }, { label: null, merge: true }, { label: ' ', merge: true },
    { label: '地域別実績', merge: false }, { label: '', merge: false }, { label: '地域別実績' }]) {
    const result = succeeded(apply(book(), [matrix({ corner })])), after = sheet(result);
    const expectedMerge = corner.merge ?? Boolean(corner.label?.trim());
    assert.deepEqual(result.results[0].layout.cornerRange, cornerRange);
    assert.equal(after.merges.some(merge => JSON.stringify(merge) === JSON.stringify(cornerRange)), expectedMerge);
    assert.equal(result.results[0].layout.merges.some(merge => JSON.stringify(merge) === JSON.stringify(cornerRange)), expectedMerge);
    assert.equal(after.cells.B2.value, corner.label?.trim() ? corner.label : '');
    for (const address of ['C2', 'B3', 'C3']) assert.equal(after.cells[address].value, '', address);
  }
});

test('unmerged corners do not require merge permission and retain comments in their blank cells', () => {
  const command = matrix({ headers: [{ label: '列分類', children: ['売上'] }],
    rowHeaders: [{ label: '行分類', children: ['東京'] }], corner: undefined,
    data: { type: 'rows', values: [['100']] } });
  const before = book({}, { comments: { C3: { id: 'note', text: 'retain this note' } } });
  const result = succeeded(apply(before, [command], { features: { mergeCells: false } }));
  assert.deepEqual(result.results[0].layout.merges, []);
  assert.equal(sheet(result).comments.C3.text, 'retain this note');
  const failure = apply(book(), [{ ...command, corner: { merge: true } }], { features: { mergeCells: false } });
  assert.equal(failure.ok, false); assert.equal(failure.code, 'FEATURE_DISABLED');
});

test('an existing merged corner must match an explicitly requested merge and is never silently unmerged', () => {
  const cornerRange = range(1, 1, 2, 2), before = book({ B2: { value: 'existing' } }, { merges: [cornerRange] });
  const serialized = serializeWorkbook(before);
  for (const corner of [undefined, { label: null }, { label: '地域別実績', merge: false }]) {
    const result = apply(before, [matrix({ corner, onConflict: 'overwrite' })]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
    assert.equal(serializeWorkbook(before), serialized);
  }
  const result = succeeded(apply(before, [matrix({ corner: { merge: true }, onConflict: 'overwrite' })]));
  assert.equal(sheet(result).cells.B2.value, '');
  assert.equal(sheet(result).merges.filter(merge => JSON.stringify(merge) === JSON.stringify(cornerRange)).length, 1);
});

test('a labeled corner inherits header colors and grid borders and accepts independent partial overrides', () => {
  const border = { style: 'dashed', width: 2, color: '#667788' };
  const headerStyle = { background: '#217346', color: '#ffffff' };
  const inherited = sheet(apply(book(), [matrix({ headerStyle, border })]));
  assert.equal(inherited.cells.B2.value, '地域別実績');
  assert.equal(inherited.cells.B2.format.background, headerStyle.background);
  assert.equal(inherited.cells.B2.format.color, headerStyle.color);
  assert.deepEqual(inherited.cells.B2.format.borders, { top: border, right: border, bottom: border, left: border });
  for (const label of ['地域別実績', null]) {
    const after = sheet(apply(book(), [matrix({ headerStyle, border,
      corner: { label, style: { background: '#ffeecc' }, border: { color: '#aa0000' } } })]));
    const expected = { ...border, color: '#aa0000' };
    assert.equal(after.cells.B2.value, label ?? ''); assert.equal(after.cells.B2.format.background, '#ffeecc');
    assert.equal(after.cells.B2.format.color, label === null ? undefined : '#ffffff');
    assert.deepEqual(after.cells.B2.format.borders, { top: expected, right: expected, bottom: expected, left: expected });
    assert.deepEqual(after.cells.D2.format.borders.left, border); assert.equal(after.cells.D2.format.background, '#217346');
  }
  const withoutBorders = sheet(apply(book(), [matrix({ headerStyle, border,
    corner: { label: '地域別実績', border: { style: 'none' } } })]));
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.equal(withoutBorders.cells.B2.format.borders[edge].style, 'none');
});

test('clearing corner borders preserves existing unrelated formats and adjacent header edges', () => {
  const oldBorder = { style: 'solid', width: 3, color: '#aa0000' };
  const oldFormat = { bold: true, italic: true, background: '#ffeecc', color: '#112233',
    borders: { top: oldBorder, right: oldBorder, bottom: oldBorder, left: oldBorder } };
  const before = book(Object.fromEntries(['B2', 'C2', 'B3', 'C3'].map(address => [address, { value: '', format: oldFormat }])));
  const serializedBefore = serializeWorkbook(before);
  const result = succeeded(apply(before, [matrix({ corner: undefined, headerStyle: { background: '#217346', color: '#ffffff' } })]));
  const after = sheet(result);
  for (const address of ['B2', 'C2', 'B3', 'C3']) {
    assert.equal(after.cells[address].format.bold, true); assert.equal(after.cells[address].format.italic, true);
    assert.equal(after.cells[address].format.background, '#ffeecc'); assert.equal(after.cells[address].format.color, '#112233');
    assert.deepEqual(after.cells[address].format.borders, {});
  }
  assert.deepEqual(after.cells.D2.format.borders.left, { style: 'solid', width: 1, color: '#d1d5db' });
  assert.deepEqual(after.cells.B4.format.borders.top, { style: 'solid', width: 1, color: '#d1d5db' });
  assert.equal(serializeWorkbook(before), serializedBefore);
  const serializedAfter = serializeWorkbook(result.workbook), restored = parseWorkbook(serializedAfter);
  assert.equal(serializeWorkbook(restored), serializedAfter);
  assert.deepEqual(restored.sheets[0].cells.B2.format.borders, {});
});

test('all grouped, row and corner labels remain literal while body formulas calculate', () => {
  const result = succeeded(apply(book(), [write({
    headers: [{ label: '=SUM(A1)', children: ['001', 'false'] }],
    rowHeaders: [{ label: "'group", children: ['=label'] }], corner: { label: '=corner' },
    data: { type: 'rows', values: [['=2+3', '6']] },
  })]));
  const calculated = calculateWorkbook(result.workbook).main;
  assert.equal(calculated.B2, '=corner'); assert.equal(calculated.D2, '=SUM(A1)');
  assert.equal(calculated.D3, '001'); assert.equal(calculated.E3, 'false');
  assert.equal(calculated.B4, "'group"); assert.equal(calculated.C4, '=label'); assert.equal(calculated.D4, 5);
  const literalOnly = write({ headers: [{ label: '=group', children: ['=one', '=two'] }],
    rowHeaders: ['=row'], corner: { label: '=corner' }, data: { type: 'rows', values: [['1', '2']] } });
  assert.equal(apply(book(), [literalOnly], { features: { formulas: false } }).ok, true);
});

test('protruding top roots align whole subtrees to the body and preserve existing hole contents', () => {
  const before = book({ B2: { value: 'keep', format: { background: '#abcdef' } }, B3: { value: 'also keep' },
    E2: { value: 'above short group' } });
  const result = succeeded(apply(before, [write({ headerLayout: 'protruding',
    headers: ['商品', { label: '年度', children: [{ label: '上期', children: ['売上', '利益'] }] },
      { label: '備考区分', children: ['状態', '備考'] }],
    data: { type: 'rows', values: [['商品A', '100', '20', '新規', '説明']] }, onConflict: 'error',
  })]));
  const after = sheet(result);
  assert.deepEqual(after.cells.B2, before.sheets[0].cells.B2); assert.deepEqual(after.cells.B3, before.sheets[0].cells.B3);
  assert.deepEqual(after.cells.E2, before.sheets[0].cells.E2); assert.equal(after.cells.F2, undefined);
  assert.equal(after.cells.B4.value, '商品'); assert.equal(after.cells.C2.value, '年度');
  assert.equal(after.cells.C3.value, '上期'); assert.equal(after.cells.E3.value, '備考区分');
  assert.equal(after.cells.E4.value, '状態'); assert.equal(after.cells.F4.value, '備考');
  assertMerges(after.merges, [range(1, 2, 1, 3), range(2, 2, 2, 3), range(2, 4, 2, 5)]);
  assert.deepEqual(result.results[0].layout.dataRange, range(4, 1, 4, 5));
});

test('protruding row roots align to the body and allow existing merges wholly inside holes', () => {
  const untouched = range(1, 1, 1, 2);
  const before = book({ B2: { value: 'existing merged hole' } }, { merges: [untouched] });
  const result = succeeded(apply(before, [write({ headers: undefined, rowHeaderLayout: 'protruding',
    rowHeaders: ['全国', { label: '東日本', children: [{ label: '関東', children: ['東京', '横浜'] }] },
      { label: '西日本', children: ['大阪', '福岡'] }],
    data: { type: 'rows', values: [['100'], ['20'], ['30'], ['40'], ['10']] }, onConflict: 'error',
  })]));
  const after = sheet(result);
  assert.equal(after.cells.B2.value, 'existing merged hole'); assert.equal(after.cells.D2.value, '全国');
  assert.equal(after.cells.B3.value, '東日本'); assert.equal(after.cells.C3.value, '関東');
  assert.equal(after.cells.C5.value, '西日本'); assert.equal(after.cells.D5.value, '大阪');
  assert.equal(after.cells.D6.value, '福岡'); assert.equal(after.cells.E6.value, '10');
  assertMerges(after.merges, [untouched, range(2, 1, 3, 1), range(2, 2, 3, 2), range(4, 2, 5, 2)]);
  assert.ok(!result.results[0].layout.merges.some(item => JSON.stringify(item) === JSON.stringify(untouched)));
});

test('partly overlapping existing merges cannot be replaced even by overwrite', () => {
  const before = book({ B2: { value: 'existing' } }, { merges: [range(1, 1, 2, 1)] });
  const result = apply(before, [write({ headerLayout: 'protruding', onConflict: 'overwrite' })]);
  assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
  assert.equal(before.sheets[0].cells.B2.value, 'existing');
});

test('skip cannot silently merge over a conflicting header or covered cell; failures discard the complete batch', () => {
  for (const address of ['E2', 'F2', 'B3']) {
    const before = book({ [address]: { value: 'keep', format: { bold: true } } });
    const result = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { O30: 'staged' } }, write({ onConflict: 'skip' })]);
    assert.equal(result.ok, false, address); assert.equal(result.code, 'WRITE_CONFLICT');
    assert.equal(result.workbook, undefined); assert.equal(before.sheets[0].cells.O30, undefined);
    assert.equal(before.sheets[0].cells[address].value, 'keep');
  }
  const before = book({ B4: { value: 'keep body', format: { italic: true } } });
  const result = succeeded(apply(before, [write({ onConflict: 'skip' })]));
  assert.deepEqual(sheet(result).cells.B4, before.sheets[0].cells.B4);
  assert.equal(sheet(result).cells.C4.value, '商品A');
});

test('overwrite removes values hidden by generated merges but rejects covered comments', () => {
  const before = book({ F2: { value: 'covered old value' }, B3: { value: 'another covered value' } });
  const result = succeeded(apply(before, [write({ onConflict: 'overwrite' })]));
  assert.equal(sheet(result).cells.F2?.value ?? '', ''); assert.equal(sheet(result).cells.B3?.value ?? '', '');
  const commented = book({}, { comments: { F2: { id: 'note', text: 'cannot lose this note' } } });
  const failure = apply(commented, [write({ onConflict: 'overwrite' })]);
  assert.equal(failure.ok, false); assert.equal(failure.workbook, undefined);
  assert.equal(commented.sheets[0].comments.F2.text, 'cannot lose this note');
});

test('axis size mismatches, invalid nodes, ambiguous corners and bad styles never partially apply', () => {
  const invalid = [
    { headers: ['one'] }, { rowHeaders: ['only one row'] },
    { headers: [{ label: 'empty', children: [] }] }, { headers: [{ label: 'missing child', children: new Array(2) }] },
    { headers: [{ label: 5, children: ['a', 'b'] }] }, { headers: [{ label: 'bad', children: 'no' }] },
    { headers: [{ label: 'bad style', children: ['a', 'b'], style: { bold: true } }] },
    { headerLayout: 'unknown' }, { rowHeaderLayout: 'unknown' }, { corner: { label: 'unpaired corner' } },
    { rowHeaders: ['a', 'b'], rowNumbers: {} }, { rowHeaderStyle: { background: 'red; color: black' } },
    { headers: undefined, data: { type: 'rows', values: [['one'], ['two', 'extra']] } },
    { target: { row: 29, column: 0 } },
  ];
  for (const patch of invalid) {
    const before = book(), result = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { O30: 'staged' } }, write(patch)]);
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.equal(result.workbook, undefined);
    assert.equal(before.sheets[0].cells.O30, undefined);
  }
});

test('merging, formatting and formula guards apply to grouped writes without requiring structured tables', () => {
  const command = matrix({ data: { type: 'rows', values: [['=1+2', '2', ''], ['3', '4', ''], ['5', '6', '']] } });
  for (const features of [{ mergeCells: false }, { formatting: false }, { formulas: false }]) {
    const result = apply(book(), [command], { features });
    assert.equal(result.code, 'FEATURE_DISABLED', JSON.stringify(features)); assert.equal(result.workbook, undefined);
  }
  assert.equal(apply(book(), [command], { features: { tables: false } }).ok, true);
  const flat = write({ headers: ['a', 'b'], data: { type: 'rows', values: [['1', '2']] } });
  assert.equal(apply(book(), [flat], { features: { mergeCells: false } }).ok, true);
});

test('a grouped write is one undoable session edit and native serialization stores only ordinary cells and merges', () => {
  const session = createSpreadsheetSession(book()), before = session.getWorkbook();
  const result = session.execute(matrix()); assert.equal(result.ok, true, result.message);
  const after = session.getWorkbook();
  assert.deepEqual(session.getHistoryState(), { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 });
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
  const serialized = serializeWorkbook(after), restored = parseWorkbook(serialized);
  assert.equal(serializeWorkbook(restored), serialized); assertMerges(restored.sheets[0].merges, after.sheets[0].merges);
  assert.equal(restored.sheets[0].tables, undefined); assert.doesNotMatch(serialized, /"(?:headers|rowHeaders|children|headerLayout)":/);
  assert.ok(Object.isFrozen(after.sheets[0].cells)); assert.ok(Object.isFrozen(after.sheets[0].merges));
});

test('unknown nested header and corner properties are rejected rather than silently ignored', () => {
  const invalid = [
    { headers: [{ label: 'Group', children: ['a', 'b'], rowspan: 3 }] },
    { headers: [{ label: 'Group', children: [{ label: 'a', colour: '#ffffff' }, 'b'] }] },
    { rowHeaders: [{ label: 'Group', children: ['a', 'b'], colspan: 2 }, 'c'] },
    { rowHeaders: [{ label: 'Group', children: [{ label: 'a', style: { fontSize: 20 } }, 'b'] }, 'c'] },
    { corner: { label: 'Corner', children: ['ignored'] } },
    { corner: { label: 'Corner', style: { background: '#ffffff', align: 'center' } } },
    { corner: { label: 123 } },
    { corner: { label: false } },
    { corner: { label: 'Corner', border: { color: '#ffffff', unknown: true } } },
    { corner: { label: 'Corner', border: null } },
    { corner: { label: 'Corner', border: { style: 'invalid' } } },
    { corner: { merge: null } },
    { corner: { merge: 1 } },
    { corner: { merge: 'true' } },
  ];
  for (const patch of invalid) {
    const before = book(), result = apply(before, [
      { type: 'cells.set', sheetId: 'main', values: { O30: 'must not survive' } }, matrix(patch),
    ]);
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.equal(result.commandIndex, 1);
    assert.equal(result.workbook, undefined); assert.equal(before.sheets[0].cells.O30, undefined);
  }
});

test('sparse root and child arrays fail on both axes without changing the input workbook', () => {
  const invalid = [
    { headers: ['a', , 'b'] },
    { headers: [{ label: 'Group', children: ['a', , 'b'] }] },
    { rowHeaders: ['a', , 'b'] },
    { rowHeaders: [{ label: 'Group', children: ['a', , 'b'] }] },
  ];
  for (const patch of invalid) {
    const before = book(), result = apply(before, [matrix(patch)]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
    assert.deepEqual(Object.keys(before.sheets[0].cells), []);
  }
});

test('cyclic trees are bounded and rejected, while reusing an acyclic subtree is permitted', () => {
  const direct = { label: 'cycle' }; direct.children = [direct];
  const outer = { label: 'outer' }, inner = { label: 'inner', children: [outer] }; outer.children = [inner];
  for (const axis of ['headers', 'rowHeaders']) for (const node of [direct, outer]) {
    const before = book(), result = apply(before, [matrix({ [axis]: [node] })]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
    assert.match(result.message, /循環/); assert.equal(node.children[0], node === direct ? direct : inner);
  }
  const shared = { label: '共通区分', children: ['売上', '利益'] };
  const result = succeeded(apply(book(), [write({ headers: [shared, shared], data: { type: 'rows', values: [['1', '2', '3', '4']] } })]));
  assert.equal(sheet(result).cells.B2.value, '共通区分'); assert.equal(sheet(result).cells.D2.value, '共通区分');
  assertMerges(sheet(result).merges, [range(1, 1, 1, 2), range(1, 3, 1, 4)]);
});

test('matching existing merges are reused and repeated writes remain no-ops without duplicate history', () => {
  const session = createSpreadsheetSession(book()), command = matrix();
  const first = session.execute(command); assert.equal(first.ok, true, first.message);
  const before = session.getWorkbook(), history = session.getHistoryState();
  for (const onConflict of ['overwrite', 'error', 'skip']) {
    const result = session.execute({ ...command, onConflict });
    assert.equal(result.ok, true, result.message); assert.equal(result.changed, false);
    assert.equal(result.results[0].write.changedCount, 0); assert.equal(session.getWorkbook(), before);
    assert.deepEqual(session.getHistoryState(), history); assert.equal(session.getWorkbook().sheets[0].merges.length, 5);
  }
  const recolored = session.execute({ ...command, headerStyle: { background: '#ffeecc' }, onConflict: 'error' });
  assert.equal(recolored.ok, true, recolored.message); assert.equal(recolored.changed, true);
  assert.equal(session.getWorkbook().sheets[0].merges.length, 5);
  assert.equal(session.getWorkbook().sheets[0].cells.D2.format.background, '#ffeecc');
});

test('header-only grouped writes fit exactly at sheet boundaries and reject a one-cell overflow', () => {
  const command = write({ headers: [{ label: 'Group', children: ['a', 'b'] }],
    target: { row: 28, column: 13 }, data: { type: 'rows', values: [] } });
  const result = succeeded(apply(book(), [command]));
  assert.deepEqual(result.results[0].range, range(28, 13, 29, 14));
  assert.equal(result.results[0].layout.dataRange, undefined);
  assert.equal(sheet(result).cells.N29.value, 'Group'); assert.equal(sheet(result).cells.O30.value, 'b');
  for (const target of [{ row: 29, column: 13 }, { row: 28, column: 14 }, { row: -1, column: 0 },
    { row: 0.5, column: 0 }, { row: Infinity, column: 0 }]) {
    const failed = apply(book(), [{ ...command, target }]);
    assert.equal(failed.ok, false, JSON.stringify(target)); assert.equal(failed.workbook, undefined);
  }
});

test('the grid area limit includes expanded hierarchy rows and bounds deep untrusted trees', () => {
  const large = normalizeWorkbook({ sheets: [{ id: 'main', name: 'Large', rowCount: 10000, columnCount: 2, cells: {} }] });
  const command = write({ target: { row: 0, column: 0 }, headers: [{ label: 'Group', children: ['a', 'b'] }],
    data: { type: 'rows', values: Array.from({ length: 4998 }, () => ['1', '2']) } });
  const result = succeeded(apply(large, [command]));
  assert.deepEqual(result.results[0].range, range(0, 0, 4999, 1));
  assert.equal(Object.keys(sheet(result).cells).length, 10000);
  const oversized = apply(large, [{ ...command, data: { type: 'rows', values: [...command.data.values, ['3', '4']] } }]);
  assert.equal(oversized.ok, false); assert.equal(oversized.workbook, undefined); assert.match(oversized.message, /10,000/);
  let root = 'leaf';
  for (let index = 0; index < 10000; index++) root = { label: 'group', children: [root] };
  const tooDeep = apply(large, [write({ target: { row: 0, column: 0 }, headers: [root], data: { type: 'rows', values: [] } })]);
  assert.equal(tooDeep.ok, false); assert.equal(tooDeep.workbook, undefined); assert.match(tooDeep.message, /10,000/);
});
