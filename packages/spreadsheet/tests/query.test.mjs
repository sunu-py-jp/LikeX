import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({ stdin: { contents: `export * from './query'; export * from './query-reader';`,
  resolveDir: fileURLToPath(new URL('../src/model', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { getCell, getRange, getSheet, getDrawing, getImage, getShape, getTextBox, getImageResource,
  getCellComment, createSpreadsheetReader } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const makeWorkbook = () => ({ schemaVersion: 1, sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
  cells: {
    A1: { value: '2', format: { bold: true, borders: { bottom: { color: '#123', width: 2 } } } },
    B1: { value: '=A1*2' }, A2: { value: '', format: { background: '#fff' } },
    B2: { value: 'yes', validation: { type: 'list', values: ['yes', 'no'] } },
  },
  rowHeights: { 2: 36 }, columnWidths: { 0: 150 },
  drawings: [
    { type: 'image', id: 'image-1', resourceId: 'resource-1', alt: 'Description', width: 100, height: 80,
      anchor: { row: 3, column: 2, offsetX: 1, offsetY: 2 } },
    { type: 'shape', id: 'shape-1', shape: 'rectangle', fill: '#fff', stroke: '#000', strokeWidth: 1, text: 'Box', width: 120, height: 50,
      anchor: { row: 5, column: 1, offsetX: 0, offsetY: 0 } },
    { type: 'text', id: 'text-1', text: 'Title', fontSize: 16, color: '#000', background: 'transparent', width: 140, height: 40,
      anchor: { row: 8, column: 0, offsetX: 0, offsetY: 0 } },
  ],
  comments: { A1: { id: 'comment-1', text: 'A note', author: 'User' } },
  conditionalFormats: [{ id: 'cf-1', type: 'colorScale', ranges: [{ top: 0, left: 0, bottom: 1, right: 1 }], colors: ['#fff', '#abc'] }],
}], resources: { images: { 'resource-1': { name: 'image.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,example', width: 100, height: 80 } } } });

test('read queries depend only on the model without React, command, lifecycle or DOM code', () => {
  const dependencies = Object.keys(output.metafile.inputs).join('\n');
  assert.doesNotMatch(dependencies, /(?:\/ui\/|\/state\/|\/commands\/|node_modules\/react|\/core\/)/);
  assert.doesNotMatch(output.outputFiles[0].text, /\b(?:document|window)\./);
});

test('cell lookup returns raw values and canonicalizes the requested address without recalculation', () => {
  const workbook = makeWorkbook();
  assert.equal(getCell(workbook, sheetId, '$a$1').value, '2');
  assert.equal(getCell(workbook, sheetId, 'b1').value, '=A1*2');
  assert.equal(getCell(workbook, sheetId, 'J20'), undefined);
  assert.deepEqual(getCell(workbook, sheetId, 'A2'), { value: '', format: { background: '#fff' } });
});

test('range reads preserve its exact rectangular shape and represent missing cells as null', () => {
  const workbook = makeWorkbook();
  const actual = getRange(workbook, sheetId, { top: 0, left: 0, bottom: 2, right: 2 });
  assert.deepEqual(actual.map(row => row.map(cell => cell?.value ?? null)), [
    ['2', '=A1*2', null], ['', 'yes', null], [null, null, null],
  ]);
  assert.deepEqual(getRange(workbook, sheetId, '$a$1:c3'), actual);
  assert.deepEqual(getRange(workbook, sheetId, 'B2'), [[workbook.sheets[0].cells.B2]]);
  assert.deepEqual(getRange(workbook, sheetId, 'J20'), [[null]]);
});

test('merged children are not redirected and ranges are not expanded to contain a merge', () => {
  const workbook = makeWorkbook();
  delete workbook.sheets[0].cells.B1;
  workbook.sheets[0].merges = [{ top: 0, left: 0, bottom: 0, right: 1 }];
  assert.equal(getCell(workbook, sheetId, 'B1'), undefined);
  assert.equal(getCellComment(workbook, sheetId, 'B1'), undefined);
  assert.deepEqual(getRange(workbook, sheetId, 'B1:C1'), [[null, null]]);
  assert.equal(getRange(workbook, sheetId, 'A1:B1')[0][0].value, '2');
});

test('cell and range results deeply isolate nested styles and validation arrays from mutable input', () => {
  const workbook = makeWorkbook(), cell = getCell(workbook, sheetId, 'A1'), range = getRange(workbook, sheetId, 'A1:B2');
  assert.notEqual(cell, workbook.sheets[0].cells.A1);
  assert.notEqual(cell.format.borders.bottom, workbook.sheets[0].cells.A1.format.borders.bottom);
  assert.ok(Object.isFrozen(cell)); assert.ok(Object.isFrozen(cell.format.borders.bottom));
  assert.ok(Object.isFrozen(range)); assert.ok(Object.isFrozen(range[0])); assert.ok(Object.isFrozen(range[1][1].validation.values));
  assert.throws(() => { cell.value = 'bad'; }, TypeError);
  assert.throws(() => { range[1][1].validation.values.push('bad'); }, TypeError);
  workbook.sheets[0].cells.A1.format.borders.bottom.color = '#fff';
  workbook.sheets[0].cells.B2.validation.values[0] = 'changed';
  assert.equal(cell.format.borders.bottom.color, '#123');
  assert.equal(range[1][1].validation.values[0], 'yes');
  assert.equal(Object.isFrozen(workbook.sheets[0].cells.A1), false);
});

test('sheet snapshots copy all data while resource bytes are retrieved separately', () => {
  const workbook = makeWorkbook(), sheet = getSheet(workbook, sheetId);
  assert.deepEqual(sheet, workbook.sheets[0]);
  assert.notEqual(sheet, workbook.sheets[0]);
  assert.ok(Object.isFrozen(sheet.drawings[0].anchor));
  assert.ok(Object.isFrozen(sheet.conditionalFormats[0].colors));
  assert.equal(Object.hasOwn(sheet, 'resources'), false);
  workbook.sheets[0].comments.A1.text = 'Changed';
  workbook.sheets[0].drawings[0].anchor.row = 15;
  assert.equal(sheet.comments.A1.text, 'A note');
  assert.equal(sheet.drawings[0].anchor.row, 3);
});

test('drawing getters separate placement IDs and image resource IDs and narrow by drawing type', () => {
  const workbook = makeWorkbook();
  assert.equal(getDrawing(workbook, sheetId, 'image-1').resourceId, 'resource-1');
  assert.equal(getImage(workbook, sheetId, 'image-1').alt, 'Description');
  assert.equal(getShape(workbook, sheetId, 'shape-1').shape, 'rectangle');
  assert.equal(getTextBox(workbook, sheetId, 'text-1').text, 'Title');
  assert.equal(getImage(workbook, sheetId, 'shape-1'), undefined);
  assert.equal(getShape(workbook, sheetId, 'text-1'), undefined);
  assert.equal(getTextBox(workbook, sheetId, 'image-1'), undefined);
  assert.equal(getImage(workbook, sheetId, 'resource-1'), undefined);
  assert.equal(getImageResource(workbook, 'image-1'), undefined);
  assert.deepEqual(getImageResource(workbook, 'resource-1'), workbook.resources.images['resource-1']);
  for (const getter of [getDrawing, getImage, getShape, getTextBox]) assert.equal(getter(workbook, sheetId, 'missing'), undefined);
});

test('different image placements can reference the same separately retrieved resource', () => {
  const workbook = makeWorkbook();
  workbook.sheets[0].drawings.push({ ...workbook.sheets[0].drawings[0], id: 'image-2', anchor: { row: 9, column: 2, offsetX: 0, offsetY: 0 } });
  const image = getImage(workbook, sheetId, 'image-2');
  assert.equal(image.anchor.row, 9);
  assert.equal(getImageResource(workbook, image.resourceId).name, 'image.png');
});

test('drawing, resource and comment snapshots are detached and frozen', () => {
  const workbook = makeWorkbook(), drawing = getImage(workbook, sheetId, 'image-1'), resource = getImageResource(workbook, 'resource-1'),
    comment = getCellComment(workbook, sheetId, '$a$1');
  assert.ok(Object.isFrozen(drawing.anchor)); assert.ok(Object.isFrozen(resource)); assert.ok(Object.isFrozen(comment));
  assert.throws(() => { drawing.anchor.row = 0; }, TypeError);
  assert.throws(() => { resource.dataUrl = 'bad'; }, TypeError);
  workbook.resources.images['resource-1'].name = 'new.png'; workbook.sheets[0].comments.A1.text = 'new';
  assert.equal(resource.name, 'image.png'); assert.equal(comment.text, 'A note');
  assert.equal(getCellComment(workbook, sheetId, 'A2'), undefined);
});

test('missing optional containers consistently return undefined', () => {
  const workbook = makeWorkbook(); delete workbook.resources; delete workbook.sheets[0].drawings; delete workbook.sheets[0].comments;
  assert.equal(getImageResource(workbook, 'resource-1'), undefined);
  assert.equal(getDrawing(workbook, sheetId, 'image-1'), undefined);
  assert.equal(getCellComment(workbook, sheetId, 'A1'), undefined);
  workbook.resources = {};
  assert.equal(getImageResource(workbook, 'resource-1'), undefined);
});

test('address and range errors reject instead of being confused with blank cells', () => {
  const workbook = makeWorkbook();
  for (const address of ['', 'A0', 'A01', 'K1', 'A21', 'Sheet1!A1', 'A1:B2', null]) {
    assert.throws(() => getCell(workbook, sheetId, address));
    assert.throws(() => getCellComment(workbook, sheetId, address));
  }
  for (const range of ['', 'A1:', ':A2', 'C3:A1', 'A1:B2:C3', 'Sheet1!A1:B2', 'A:A', '1:2', 'A1:K20',
    null, {}, [], { top: 0.5, left: 0, bottom: 1, right: 1 }, { top: 0, left: 0, bottom: Infinity, right: 1 }])
    assert.throws(() => getRange(workbook, sheetId, range));
});

test('range queries enforce the 10000 cell limit before allocating the matrix', () => {
  const workbook = makeWorkbook(); workbook.sheets[0].rowCount = 1000; workbook.sheets[0].columnCount = 1000;
  assert.throws(() => getRange(workbook, sheetId, { top: 0, left: 0, bottom: 999, right: 999 }), /10,000/);
  const allowed = getRange(workbook, sheetId, { top: 0, left: 0, bottom: 99, right: 99 });
  assert.equal(allowed.length, 100); assert.equal(allowed[99].length, 100);
});

test('invalid or duplicate sheet IDs throw for all sheet-scoped getters', () => {
  const workbook = makeWorkbook();
  for (const getter of [getCell, getCellComment, getRange, getSheet, getDrawing, getImage, getShape, getTextBox]) {
    assert.throws(() => getter(workbook, 'missing', 'A1'));
    assert.throws(() => getter(workbook, '', 'A1'));
  }
  workbook.sheets.push(workbook.sheets[0]);
  assert.throws(() => getSheet(workbook, sheetId));
  for (const input of [null, { sheets: [] }, { sheets: [{ ...makeWorkbook().sheets[0], rowCount: 0 }] }, { ...makeWorkbook(), schemaVersion: 2 }])
    assert.throws(() => getCell(input, sheetId, 'A1'));
});

test('prototype properties are not treated as stored cells, comments or image resources', () => {
  const workbook = makeWorkbook();
  const oldCells = workbook.sheets[0].cells;
  workbook.sheets[0].cells = Object.assign(Object.create({ C3: { value: 'inherited' } }), oldCells);
  workbook.sheets[0].comments = Object.create({ C3: { id: 'fake', text: 'inherited' } });
  workbook.resources.images = Object.create({ inherited: { name: 'inherited.png' } });
  assert.equal(getCell(workbook, sheetId, 'C3'), undefined);
  assert.equal(getCellComment(workbook, sheetId, 'C3'), undefined);
  assert.equal(getImageResource(workbook, 'inherited'), undefined);
  assert.equal(getImageResource(workbook, 'constructor'), undefined);
});

test('malformed containers and duplicate drawing IDs reject clearly', () => {
  for (const cells of [null, []]) { const workbook = makeWorkbook(); workbook.sheets[0].cells = cells; assert.throws(() => getCell(workbook, sheetId, 'A1')); }
  for (const value of [null, 3, { value: 1 }]) { const workbook = makeWorkbook(); workbook.sheets[0].cells.A1 = value; assert.throws(() => getCell(workbook, sheetId, 'A1')); }
  const workbook = makeWorkbook(); workbook.sheets[0].drawings.push(workbook.sheets[0].drawings[0]);
  assert.throws(() => getDrawing(workbook, sheetId, 'image-1'));
  workbook.sheets[0].drawings = {};
  assert.throws(() => getDrawing(workbook, sheetId, 'image-1'));
  workbook.resources.images = [];
  assert.throws(() => getImageResource(workbook, 'resource-1'));
});

test('snapshot copying rejects cycles, accessors and non-JSON objects without modifying input', () => {
  for (const extra of [new Date(), () => 1, Infinity]) {
    const workbook = makeWorkbook(); workbook.sheets[0].extra = extra;
    assert.throws(() => getSheet(workbook, sheetId));
    assert.equal(Object.isFrozen(workbook.sheets[0]), false);
  }
  const cyclic = makeWorkbook(); cyclic.sheets[0].extra = cyclic.sheets[0];
  assert.throws(() => getSheet(cyclic, sheetId), /循環/);
  const getter = makeWorkbook(); let called = 0;
  Object.defineProperty(getter.sheets[0], 'extra', { enumerable: true, get: () => { called++; return 'bad'; } });
  assert.throws(() => getSheet(getter, sheetId), /アクセサー/);
  assert.equal(called, 0);
});

test('snapshot copying retains safe own __proto__ data without changing object prototypes', () => {
  const workbook = makeWorkbook(); workbook.sheets[0].extra = JSON.parse('{"__proto__":{"injected":true}}');
  const sheet = getSheet(workbook, sheetId);
  assert.equal(Object.getPrototypeOf(sheet.extra), Object.prototype);
  assert.equal(Object.hasOwn(sheet.extra, '__proto__'), true);
  assert.equal(sheet.extra.__proto__.injected, true);
  assert.equal({}.injected, undefined);
});

test('bound reader fetches the latest workbook per call, accepts frozen snapshots and preserves earlier results', () => {
  let workbook = makeWorkbook(), calls = 0;
  const reader = createSpreadsheetReader(() => { calls++; return workbook; });
  const earlier = reader.getCell(sheetId, 'A1');
  workbook = structuredClone(workbook); workbook.sheets[0].cells.A1.value = 'updated';
  assert.equal(reader.getCell(sheetId, 'A1').value, 'updated');
  assert.equal(earlier.value, '2'); assert.equal(calls, 2); assert.ok(Object.isFrozen(reader));
  for (const [method, args, direct] of [
    ['getRange', [sheetId, 'A1:B2'], getRange], ['getSheet', [sheetId], getSheet],
    ['getDrawing', [sheetId, 'image-1'], getDrawing], ['getImage', [sheetId, 'image-1'], getImage],
    ['getShape', [sheetId, 'shape-1'], getShape], ['getTextBox', [sheetId, 'text-1'], getTextBox],
    ['getImageResource', ['resource-1'], getImageResource], ['getCellComment', [sheetId, 'A1'], getCellComment],
  ]) assert.deepEqual(reader[method](...args), direct(workbook, ...args));
  const frozen = { ...workbook, sheets: [reader.getSheet(sheetId)] }; Object.freeze(frozen.sheets); Object.freeze(frozen);
  assert.equal(getCell(frozen, sheetId, 'A1').value, 'updated');
});
