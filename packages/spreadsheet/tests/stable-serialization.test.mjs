import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, serializeWorkbook, parseWorkbook, createSpreadsheetSession, SPREADSHEET_FILE_VERSION, SPREADSHEET_LIMITS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const hash = json => createHash('sha256').update(json, 'utf8').digest('hex');
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
const content = ' 日本語の資料 📄\r\n 余白・タブ\t・e\u0301・éをそのまま保持 ';
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
}
function workbook() {
  const image = name => ({ name, mimeType: 'image/png', dataUrl, width: 1, height: 1 });
  const picture = id => ({ id, type: 'image', resourceId: id, alt: content,
    anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 100 });
  return normalizeWorkbook({ sheets: [
    { id: 'z-sheet', name: '資料', rowCount: 30, columnCount: 12, cells: {
      B2: { value: '2', validation: { type: 'number', min: 0, max: 5 } }, A2: { value: '1' }, A1: { value: content, format: {
        color: '#123456', bold: true, borders: { left: { color: '#333333', width: 2, style: 'solid' }, bottom: { style: 'dotted' } },
      } }, A10: { value: '=SUM(A2:B2)' },
    }, columnWidths: { 2: 80, 10: 120 }, rowHeights: { 2: 25, 10: 40 },
    comments: { B2: { id: 'z-comment', text: '後ろ' }, A1: { id: 'a-comment', text: '前' } },
    drawings: [picture('z-image'), picture('a-image')],
    merges: [{ top: 4, left: 0, bottom: 4, right: 1 }],
    conditionalFormats: [{ id: 'positive', type: 'comparison', operator: 'gt', value: 0,
      ranges: [{ top: 1, left: 0, bottom: 1, right: 1 }], format: { bold: true } }] },
    { id: 'a-sheet', name: '集計', rowCount: 30, columnCount: 12, cells: {} },
  ], resources: { images: { 'z-image': image('後ろ.png'), 'a-image': image('前.png') } }, namedRanges: [
    { id: 'z-range', name: 'ZRange', sheetId: 'z-sheet', range: { top: 0, left: 0, bottom: 1, right: 1 } },
    { id: 'a-range', name: 'ARange', sheetId: 'a-sheet', range: { top: 0, left: 0, bottom: 0, right: 0 } },
  ] });
}

test('SPON bytes and hashes ignore all object-key insertion order, including cells, resources and nested maps', () => {
  const original = workbook(), reversed = reverseKeys(original), before = structuredClone(reversed);
  const saved = serializeWorkbook(original), reordered = serializeWorkbook(reversed);
  assert.equal(reordered, saved);
  assert.equal(hash(reordered), hash(saved));
  assert.deepEqual(reversed, before, 'serialization must not reorder caller-owned data');
  const wire = JSON.parse(saved);
  assert.equal(wire.schemaVersion, SPREADSHEET_FILE_VERSION); assert.equal(SPREADSHEET_FILE_VERSION, 1);
  assert.deepEqual(Object.keys(wire.sheets[0].rows[1].cells), ['A', 'B']);
  assert.match(saved, /"columnWidths": \{\n +"2": 80,\n +"10": 120\n +\}/);
  assert.deepEqual(Object.keys(wire.resources.images), ['a-image', 'z-image']);
});

test('caller-owned resource IDs that resemble schema fields never change nested serialization rules', () => {
  const ids = ['comments', 'cells', 'columnWidths', 'images', 'rows', 'resources', 'sheets', 'format',
    'constructor', '__proto__', 'toString', 'A1', '0'];
  const image = { name: '同一画像.png', mimeType: 'image/png', dataUrl, width: 1, height: 1 };
  const original = workbook();
  const input = normalizeWorkbook({ ...original,
    resources: { images: Object.fromEntries(ids.map(id => [id, image])) },
    sheets: original.sheets.map((sheet, index) => index ? sheet : { ...sheet,
      drawings: ids.map(id => ({ ...sheet.drawings[0], id, resourceId: id })),
    }),
  });
  const saved = serializeWorkbook(input), wire = JSON.parse(saved);
  assert.equal(serializeWorkbook(reverseKeys(input)), saved);
  assert.equal(serializeWorkbook(parseWorkbook(saved)), saved);
  assert.deepEqual(Object.keys(wire.resources.images), [...ids].sort());
  const fields = Object.keys(wire.resources.images.comments);
  for (const id of ids) {
    assert.deepEqual(Object.keys(wire.resources.images[id]), fields, id);
    assert.deepEqual(wire.resources.images[id], image, id);
  }
  assert.deepEqual(parseWorkbook(saved), input);
});

test('native save-load-save remains byte-identical without changing text, images or ordered arrays', () => {
  const saved = serializeWorkbook(workbook()), bytes = Buffer.from(saved, 'utf8');
  const parsed = parseWorkbook(bytes.toString('utf8'));
  assert.equal(serializeWorkbook(parsed), saved);
  assert.equal(hash(serializeWorkbook(parsed)), hash(saved));
  assert.equal(saved.endsWith('\n'), false); assert.equal(saved.charCodeAt(0), 123);
  assert.equal(saved.includes('\r'), false, 'file indentation uses LF; content CRLF stays escaped');
  assert.match(saved, /^\{\n  "format": "likex.spreadsheet",\n  "schemaVersion": 1,/);
  assert.deepEqual(parsed, workbook());
  assert.equal(parsed.sheets[0].cells.A1.value, content);
  assert.equal(parsed.resources.images['z-image'].dataUrl, dataUrl);
  assert.deepEqual(parsed.sheets.map(sheet => sheet.id), ['z-sheet', 'a-sheet']);
  assert.deepEqual(parsed.sheets[0].drawings.map(drawing => drawing.id), ['z-image', 'a-image']);
  assert.deepEqual(parsed.namedRanges.map(range => range.id), ['z-range', 'a-range']);
  const reversedSheets = { ...parsed, sheets: [...parsed.sheets].reverse() };
  assert.notEqual(hash(serializeWorkbook(reversedSheets)), hash(saved));
  const reorderedDrawings = { ...parsed, sheets: parsed.sheets.map((sheet, index) => index ? sheet : {
    ...sheet, drawings: [...sheet.drawings].reverse(),
  }) };
  assert.notEqual(hash(serializeWorkbook(reorderedDrawings)), hash(saved));
});

test('file rows follow display order, keep blank rows and heights, and omit trailing empty rows', () => {
  const input = normalizeWorkbook({ sheets: [{ id: 'one', name: 'One', rowCount: 300, columnCount: 30,
    cells: { AA10: { value: 'right' }, B2: { value: 'second' }, Z10: { value: 'left' }, A2: { value: 'first' } },
    rowHeights: { 4: 40 }, columnWidths: { 25: 150, 26: 170 } }] });
  const wire = JSON.parse(serializeWorkbook(input)), sheet = wire.sheets[0];
  assert.equal(sheet.rowCount, 300); assert.equal(sheet.rows.length, 10);
  assert.deepEqual(sheet.rows[0], {}); assert.deepEqual(sheet.rows[2], {});
  assert.deepEqual(sheet.rows[4], { height: 40 });
  assert.deepEqual(Object.keys(sheet.rows[1].cells), ['A', 'B']);
  assert.deepEqual(Object.keys(sheet.rows[9].cells), ['Z', 'AA']);
  assert.equal('rowHeights' in sheet, false); assert.equal('cells' in sheet, false);
  assert.deepEqual(parseWorkbook(JSON.stringify(wire)), input);
  sheet.rows.push({}, { cells: {} });
  assert.equal(serializeWorkbook(parseWorkbook(JSON.stringify(wire))), serializeWorkbook(input));
  const session = createSpreadsheetSession(input);
  assert.equal(session.execute({ type: 'rows.insert', sheetId: 'one', index: 1, values: [['inserted']] }).ok, true);
  const afterInsert = JSON.parse(serializeWorkbook(session.getWorkbook()));
  assert.equal(afterInsert.sheets[0].rows[1].cells.A.value, 'inserted');
  assert.deepEqual(afterInsert.sheets[0].rows[2], wire.sheets[0].rows[1]);
  assert.equal(session.undo(), true);
  assert.equal(serializeWorkbook(session.getWorkbook()), serializeWorkbook(input));
});

test('SPON v1 parser rejects flat sheet fields, invalid row and column containers, bounds and metadata', () => {
  const valid = JSON.parse(serializeWorkbook(workbook()));
  const rejects = mutate => { const input = structuredClone(valid); mutate(input); assert.throws(() => parseWorkbook(JSON.stringify(input))); };
  rejects(input => { input.sheets[0].cells = {}; });
  rejects(input => { input.sheets[0].rowHeights = {}; });
  rejects(input => { delete input.sheets[0].rows; });
  rejects(input => { input.sheets[0].rows = { 1: { cells: { A: { value: 'ambiguous' } } } }; });
  for (const value of [null, [], 'row']) rejects(input => { input.sheets[0].rows[0] = value; });
  rejects(input => { input.sheets[0].rows[0].unknown = true; });
  for (const value of [null, [], 4]) rejects(input => { input.sheets[0].rows[0].cells = value; });
  for (const column of ['a', 'A1', '$A', '0', 'AMJ', '__proto__']) rejects(input => {
    input.sheets[0].rows[0].cells = Object.fromEntries([[column, { value: 'bad' }]]);
  });
  for (const height of [null, '30', 0, 1001]) rejects(input => { input.sheets[0].rows[0].height = height; });
  rejects(input => { input.sheets[0].rows = Array.from({ length: 31 }, () => ({})); });
  rejects(input => { input.sheets[0].rows[0].cells.A.value = 1; });
  for (const format of ['likex.slide', null, 1]) rejects(input => { input.format = format; });
  rejects(input => { delete input.format; });
  rejects(input => { delete input.schemaVersion; });
  for (const version of [0, 2, 999, '1', null]) rejects(input => { input.schemaVersion = version; });
  assert.equal(Object.prototype.bad, undefined);
});

test('file parsing rejects former flat v1 and unidentified JSON while runtime models remain usable', () => {
  const runtime = workbook(), before = serializeWorkbook(runtime);
  const unidentified = structuredClone(runtime);
  delete unidentified.format; delete unidentified.schemaVersion;
  for (const input of [runtime, unidentified, { ...unidentified, schemaVersion: 1 },
    { ...unidentified, format: 'likex.spreadsheet' }]) {
    assert.throws(() => parseWorkbook(JSON.stringify(input)));
  }
  assert.deepEqual(normalizeWorkbook(unidentified), runtime);
  assert.equal(serializeWorkbook(unidentified), before);
  assert.equal(serializeWorkbook(parseWorkbook(before)), before);
  assert.equal(serializeWorkbook(runtime), before, 'rejected parses never change the caller-owned runtime model');
});

test('repeated saves add no timestamps or IDs, and Undo restores the original file hash', t => {
  const session = createSpreadsheetSession(workbook()), before = serializeWorkbook(session.getWorkbook());
  t.mock.method(globalThis.crypto, 'randomUUID', () => { throw new Error('save must not allocate an ID'); });
  t.mock.method(Date, 'now', () => { throw new Error('save must not read time'); });
  assert.equal(serializeWorkbook(session.getWorkbook()), before);
  assert.equal(session.execute({ type: 'cells.set', sheetId: 'z-sheet', values: { A1: '変更後' } }).ok, true);
  const changed = serializeWorkbook(session.getWorkbook());
  assert.notEqual(hash(changed), hash(before));
  assert.equal(session.undo(), true);
  assert.equal(serializeWorkbook(session.getWorkbook()), before);
  assert.equal(session.redo(), true);
  assert.equal(serializeWorkbook(session.getWorkbook()), changed);
});

test('stable serialization retains the complete-workbook size guard for large shared cell values', () => {
  const value = 'x'.repeat(SPREADSHEET_LIMITS.cellLength);
  const count = Math.ceil(SPREADSHEET_LIMITS.serializedCharacters / value.length);
  const cells = Object.fromEntries(Array.from({ length: count }, (_, index) => [`A${index + 1}`, { value }]));
  const input = { sheets: [{ id: 'large', name: 'Large', rowCount: count, columnCount: 1, cells }] };
  assert.throws(() => serializeWorkbook(input), /ブックの JSON は64 Mi文字以内/);
});
