import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/state/commands/stage-spreadsheet-commands"; export * from "./src/state/features"; export * from "./src/model";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'commands-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { stageSpreadsheetCommands, MAX_SPREADSHEET_COMMANDS, resolveSpreadsheetFeatures, createWorkbook, normalizeWorkbook,
  serializeWorkbook, parseWorkbook, setCellValues, addSheet, workbooksEqual } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const features = resolveSpreadsheetFeatures();
const nextIds = () => { let next = 0; return () => `command-${++next}`; };
const run = (workbook, commands, overrides, nextId = nextIds()) => stageSpreadsheetCommands(workbook, commands, resolveSpreadsheetFeatures(overrides), nextId);
const initial = () => setCellValues(createWorkbook(), 'sheet-1', { A1: '10', B1: '20', D1: '=SUM(A1:B1)' });
const first = result => result.workbook.sheets[0];
const range = { top: 2, left: 2, bottom: 3, right: 3 };
const anchor = { row: 2, column: 3 };
const imageResource = { name: 'sample.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };

test('commands stage in order without mutating the source or caller payload and freeze all output boundaries', () => {
  const workbook = initial(), values = { A2: '30' }, format = { bold: true };
  const result = run(workbook, [
    { type: 'cells.set', sheetId: 'sheet-1', values },
    { type: 'rows.insert', sheetId: 'sheet-1', index: 0 },
    { type: 'cells.format', sheetId: 'sheet-1', addresses: ['A3'], format },
  ]);
  assert.equal(result.ok, true); assert.equal(result.changed, true);
  assert.equal(workbook.sheets[0].cells.A2, undefined); assert.deepEqual(values, { A2: '30' }); assert.deepEqual(format, { bold: true });
  assert.deepEqual(first(result).cells.A3, { value: '30', format: { bold: true } });
  assert.equal(first(result).cells.D2.value, '=SUM(A2:B2)');
  assert.deepEqual(result.results.map(item => item.type), ['cells.set', 'rows.insert', 'cells.format']);
  for (const value of [result, result.results, result.results[0], result.workbook, first(result), first(result).cells, first(result).cells.A3.format])
    assert.equal(Object.isFrozen(value), true);
  values.A2 = 'later mutation'; format.bold = false;
  assert.equal(first(result).cells.A3.value, '30'); assert.equal(first(result).cells.A3.format.bold, true);
});

test('failure at a later command returns no partial workbook or receipts and leaves the original intact', () => {
  const workbook = initial(), snapshot = serializeWorkbook(workbook);
  const result = run(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { A1: '99' } },
    { type: 'rows.delete', sheetId: 'sheet-1', index: 0, count: 100 }]);
  assert.equal(result.ok, false); assert.equal(result.commandIndex, 1); assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal('workbook' in result, false); assert.equal('results' in result, false);
  assert.equal(serializeWorkbook(workbook), snapshot); assert.equal(Object.isFrozen(result), true);
});

test('empty batches and net-zero changes preserve the original workbook reference', () => {
  const workbook = initial();
  for (const commands of [[], [{ type: 'cells.set', sheetId: 'sheet-1', values: { A1: '10' } }], [
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: '99' } }, { type: 'cells.set', sheetId: 'sheet-1', values: { A1: '10' } },
  ]]) {
    const result = run(workbook, commands);
    assert.equal(result.ok, true); assert.equal(result.changed, false); assert.equal(result.workbook, workbook);
    assert.equal(result.results.length, commands.length);
  }
});

test('all row/column operations reuse reference transforms and resize preserves the existing bounds', () => {
  const workbook = initial();
  const result = run(workbook, [
    { type: 'rows.insert', sheetId: 'sheet-1', index: 1, count: 2 }, { type: 'rows.delete', sheetId: 'sheet-1', index: 1, count: 2 },
    { type: 'columns.insert', sheetId: 'sheet-1', index: 0 }, { type: 'columns.delete', sheetId: 'sheet-1', index: 0 },
    { type: 'columns.resize', sheetId: 'sheet-1', column: 2, width: 250 },
  ]);
  assert.equal(result.ok, true); assert.equal(first(result).rowCount, 100); assert.equal(first(result).columnCount, 26);
  assert.equal(first(result).cells.D1.value, '=SUM(A1:B1)'); assert.equal(first(result).columnWidths[2], 250);
});

test('merge requires explicit permission for lost values, and unmerge is part of the same atomic transaction', () => {
  const workbook = initial(), merge = { top: 0, left: 0, bottom: 0, right: 1 };
  const rejected = run(workbook, [{ type: 'cells.merge', sheetId: 'sheet-1', range: merge }]);
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'VALIDATION_FAILED');
  const accepted = run(workbook, [{ type: 'cells.merge', sheetId: 'sheet-1', range: merge, discardContent: true }]);
  assert.equal(accepted.ok, true); assert.deepEqual(first(accepted).merges, [merge]); assert.equal(first(accepted).cells.B1, undefined);
  const unmerged = run(accepted.workbook, [{ type: 'cells.unmerge', sheetId: 'sheet-1', range: merge }]);
  assert.equal(unmerged.ok, true); assert.equal(first(unmerged).merges, undefined); assert.equal(first(unmerged).cells.A1.value, '10');
  const noChange = run(workbook, [{ type: 'cells.merge', sheetId: 'sheet-1', range }, { type: 'cells.unmerge', sheetId: 'sheet-1', range }]);
  assert.equal(noChange.changed, false); assert.equal(noChange.workbook, workbook);
});

test('shape/text/image defaults match the GUI and generated identifiers are returned', () => {
  const result = run(createWorkbook(), [
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'arrow', anchor: { ...anchor, offsetX: 8 } },
    { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor },
    { type: 'images.insert', sheetId: 'sheet-1', anchor, resource: imageResource },
  ]);
  assert.equal(result.ok, true);
  const [rectangle, arrow, text, image] = first(result).drawings;
  assert.deepEqual(rectangle, { id: 'command-1', type: 'shape', shape: 'rectangle', anchor: { ...anchor, offsetX: 0, offsetY: 0 },
    width: 160, height: 100, fill: '#e8f3ec', stroke: '#217346', strokeWidth: 2 });
  assert.equal(arrow.height, 72); assert.equal(arrow.fill, 'transparent'); assert.equal(arrow.anchor.offsetX, 8);
  assert.equal(text.text, 'テキスト'); assert.equal(text.width, 200); assert.equal(text.height, 80); assert.equal(text.color, 'currentColor');
  assert.equal(image.width, 1); assert.equal(image.height, 1); assert.equal(image.alt, 'sample.png');
  assert.equal(result.results[3].drawingId, 'command-5'); assert.equal(result.results[3].resourceId, 'command-4');
  assert.ok(workbooksEqual(result.workbook, parseWorkbook(serializeWorkbook(result.workbook))));
});

test('explicit drawing sizes, appearance and offset positions are retained without retaining caller references', () => {
  const command = { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor: { row: 2, column: 5, offsetY: 15 },
    text: '外部から追加', width: 320, height: 110, fontSize: 20, bold: true, color: '#123', background: '#fff' };
  const result = run(createWorkbook(), [command]); assert.equal(result.ok, true);
  const drawing = first(result).drawings[0];
  assert.deepEqual(drawing.anchor, { row: 2, column: 5, offsetX: 0, offsetY: 15 });
  assert.equal(drawing.width, 320); assert.equal(drawing.bold, true);
  command.anchor.row = 8; command.text = 'changed';
  assert.equal(drawing.anchor.row, 2); assert.equal(drawing.text, '外部から追加');
});

test('each typed drawing update supports only its drawing kind and retains identity', () => {
  const inserted = run(createWorkbook(), [
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor },
    { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor },
    { type: 'images.insert', sheetId: 'sheet-1', anchor, resource: imageResource },
  ]);
  const result = run(inserted.workbook, [
    { type: 'shapes.update', sheetId: 'sheet-1', drawingId: 'command-1', patch: { shape: 'ellipse', fill: '#f00', anchor: { row: 1, column: 1 } } },
    { type: 'textBoxes.update', sheetId: 'sheet-1', drawingId: 'command-2', patch: { text: 'updated', fontSize: 24, bold: true } },
    { type: 'images.update', sheetId: 'sheet-1', drawingId: 'command-4', patch: { alt: 'new alt', width: 120, height: 100 } },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(first(result).drawings[0].anchor, { row: 1, column: 1, offsetX: 0, offsetY: 0 });
  assert.equal(first(result).drawings[0].shape, 'ellipse'); assert.equal(first(result).drawings[1].text, 'updated');
  assert.equal(first(result).drawings[2].resourceId, 'command-3'); assert.equal(first(result).drawings[2].alt, 'new alt');
  assert.equal(result.results[2].resourceId, 'command-3');
  for (const patch of [{ id: 'steal' }, { type: 'text' }, { text: 'not an image field' }]) {
    const bad = run(inserted.workbook, [{ type: 'images.update', sheetId: 'sheet-1', drawingId: 'command-4', patch }]);
    assert.equal(bad.ok, false); assert.equal(bad.code, 'INVALID_COMMAND');
  }
  const wrongKind = run(inserted.workbook, [{ type: 'images.update', sheetId: 'sheet-1', drawingId: 'command-1', patch: { alt: 'bad' } }]);
  assert.equal(wrongKind.ok, false); assert.equal(wrongKind.code, 'INVALID_TARGET');
});

test('drawing deletion removes its last image resource, with unavailable drawing IDs rejected', () => {
  const inserted = run(createWorkbook(), [{ type: 'images.insert', sheetId: 'sheet-1', anchor, resource: imageResource }]);
  const removed = run(inserted.workbook, [{ type: 'drawings.delete', sheetId: 'sheet-1', drawingId: 'command-2' }]);
  assert.equal(removed.ok, true); assert.equal(removed.workbook.resources, undefined); assert.deepEqual(first(removed).drawings, []);
  const missing = run(inserted.workbook, [{ type: 'drawings.delete', sheetId: 'sheet-1', drawingId: 'missing' }]);
  assert.equal(missing.ok, false); assert.equal(missing.code, 'INVALID_TARGET');
});

test('comments get generated IDs, preserve them when edited, and resolve merged cells to their anchor', () => {
  const result = run(createWorkbook(), [
    { type: 'cells.merge', sheetId: 'sheet-1', range },
    { type: 'comments.set', sheetId: 'sheet-1', address: 'D4', comment: { text: 'first', author: 'Alice' } },
    { type: 'comments.set', sheetId: 'sheet-1', address: 'C3', comment: { text: 'second', author: 'Bob' } },
  ]);
  assert.equal(result.ok, true); assert.deepEqual(first(result).comments.C3, { id: 'command-1', text: 'second', author: 'Bob' });
  assert.equal(result.results[1].commentId, 'command-1'); assert.equal(result.results[2].commentId, 'command-1');
  const removed = run(result.workbook, [{ type: 'comments.set', sheetId: 'sheet-1', address: 'D4', comment: null }]);
  assert.equal(removed.ok, true); assert.equal(first(removed).comments.C3, undefined); assert.equal(removed.results[0].commentId, 'command-1');
});

test('sheet commands use the injected ID factory and maintain the legacy pure model addSheet contract', () => {
  const workbook = createWorkbook();
  const commands = [{ type: 'sheets.add', name: 'Data' }, { type: 'cells.set', sheetId: 'command-1', values: { A1: 'value' } },
    { type: 'sheets.rename', sheetId: 'command-1', name: 'Renamed' }];
  const firstRun = run(workbook, commands), secondRun = run(workbook, commands);
  assert.equal(firstRun.ok, true); assert.equal(secondRun.ok, true); assert.ok(workbooksEqual(firstRun.workbook, secondRun.workbook));
  assert.equal(firstRun.workbook.sheets[1].id, 'command-1'); assert.equal(firstRun.workbook.sheets[1].name, 'Renamed');
  assert.equal(firstRun.results[0].sheetId, 'command-1'); assert.equal(firstRun.workbook.sheets[0], workbook.sheets[0]);
  const removed = run(firstRun.workbook, [{ type: 'sheets.delete', sheetId: 'command-1' }]); assert.equal(removed.ok, true);
  assert.equal(removed.workbook.sheets.length, 1);
  assert.equal(addSheet(workbook).sheets[1].name, 'Sheet2');
});

test('all feature policies apply to external commands and cannot be bypassed by an atomic batch', () => {
  const cases = [
    ['formulas', { type: 'cells.set', values: { A3: '=1+2' } }],
    ['formatting', { type: 'cells.format', addresses: ['A1'], format: { bold: true } }],
    ['rowColumnOperations', { type: 'rows.insert', index: 0 }], ['rowColumnOperations', { type: 'rows.delete', index: 0 }],
    ['rowColumnOperations', { type: 'columns.insert', index: 0 }], ['rowColumnOperations', { type: 'columns.delete', index: 0 }],
    ['resize', { type: 'columns.resize', column: 0, width: 140 }],
    ['mergeCells', { type: 'cells.merge', range }], ['mergeCells', { type: 'cells.unmerge', range }],
    ['images', { type: 'images.insert', resource: imageResource, anchor }],
    ['shapes', { type: 'shapes.insert', shape: 'ellipse', anchor }], ['textBoxes', { type: 'textBoxes.insert', anchor }],
    ['comments', { type: 'comments.set', address: 'A2', comment: { text: 'note' } }],
    ['sheets', { type: 'sheets.rename', name: 'Renamed' }], ['sheets', { type: 'sheets.delete' }],
  ];
  const workbook = initial();
  for (const [feature, command] of cases) {
    const result = run(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { A2: 'would change' } }, { ...command, sheetId: 'sheet-1' }], { [feature]: false });
    assert.equal(result.ok, false, feature); assert.equal(result.code, 'FEATURE_DISABLED', feature); assert.equal(result.commandIndex, 1, feature);
    assert.equal(workbook.sheets[0].cells.A2, undefined);
  }
  assert.equal(run(workbook, [{ type: 'sheets.add' }], { sheets: false }).code, 'FEATURE_DISABLED');
  assert.equal(run(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { A3: 'plain text' } }], { formulas: false }).ok, true);
});

test('drawing update and deletion check the feature belonging to the actual target kind', () => {
  for (const [feature, command, updateType] of [
    ['images', { type: 'images.insert', resource: imageResource, anchor }, 'images.update'],
    ['shapes', { type: 'shapes.insert', shape: 'rectangle', anchor }, 'shapes.update'],
    ['textBoxes', { type: 'textBoxes.insert', anchor }, 'textBoxes.update'],
  ]) {
    const created = run(createWorkbook(), [{ ...command, sheetId: 'sheet-1' }]);
    const drawingId = created.results[0].drawingId;
    for (const operation of [{ type: updateType, patch: { width: 400 } }, { type: 'drawings.delete' }]) {
      const result = run(created.workbook, [{ ...operation, drawingId, sheetId: 'sheet-1' }], { [feature]: false });
      assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED');
    }
  }
});

test('drawing dimensions respect resize policy while initial dimensions and unchanged values remain allowed', () => {
  const inserted = run(createWorkbook(), [{ type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor, width: 260 }], { resize: false });
  assert.equal(inserted.ok, true); assert.equal(first(inserted).drawings[0].width, 260);
  const blocked = run(inserted.workbook, [{ type: 'shapes.update', sheetId: 'sheet-1', drawingId: 'command-1', patch: { width: 300 } }], { resize: false });
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'FEATURE_DISABLED');
  const unchanged = run(inserted.workbook, [{ type: 'shapes.update', sheetId: 'sheet-1', drawingId: 'command-1', patch: { width: 260 } }], { resize: false });
  assert.equal(unchanged.ok, true); assert.equal(unchanged.changed, false);
  const moved = run(inserted.workbook, [{ type: 'shapes.update', sheetId: 'sheet-1', drawingId: 'command-1', patch: { anchor: { row: 3, column: 4 } } }], { resize: false });
  assert.equal(moved.ok, true); assert.equal(first(moved).drawings[0].anchor.row, 3);
});

test('invalid command envelopes, targets, missing payloads and unsupported patch fields return structured errors', () => {
  const workbook = initial();
  for (const command of [null, [], 'cells.set', {}, { type: 'unknown' }, { type: 'constructor' },
    { type: 'cells.set' }, { type: 'cells.set', sheetId: 'sheet-1', values: ['bad'] },
    { type: 'cells.set', sheetId: 'sheet-1', values: new Date() },
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: 42 } },
    { type: 'cells.set', sheetId: 'sheet-1', values: {}, extra: true },
    { type: 'cells.format', sheetId: 'sheet-1', addresses: null, format: {} },
    { type: 'cells.format', sheetId: 'sheet-1', addresses: ['A1'], format: { position: 'fixed' } },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor: { row: 1, column: 1, offsetX: null } },
    { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor, width: null }]) {
    const result = run(workbook, [command]); assert.equal(result.ok, false, JSON.stringify(command));
    assert.equal(result.code, 'INVALID_COMMAND'); assert.equal(result.commandIndex, 0);
  }
  for (const command of [{ type: 'cells.set', sheetId: 'missing', values: {} }, { type: 'cells.set', sheetId: 'sheet-1', values: { A1001: 'bad' } }])
    assert.equal(run(workbook, [command]).code, 'INVALID_TARGET');
});

test('model validation remains authoritative for hostile image bytes, invalid geometry and destructive sheet limits', () => {
  const workbook = createWorkbook();
  for (const command of [
    { type: 'images.insert', sheetId: 'sheet-1', anchor, resource: { ...imageResource, dataUrl: 'https://example.com/not-inline.png' } },
    { type: 'images.insert', sheetId: 'sheet-1', anchor, resource: { ...imageResource, mimeType: 'image/svg+xml' } },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor, fill: 'url(javascript:alert(1))' },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'triangle', anchor },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor: { row: 100, column: 0 } },
    { type: 'cells.merge', sheetId: 'sheet-1', range: { ...range, right: 100 } },
    { type: 'sheets.delete', sheetId: 'sheet-1' },
  ]) { const result = run(workbook, [command]); assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED'); }
  assert.equal(normalizeWorkbook(workbook).sheets[0].cells.A1, undefined);
});

test('duplicate generated IDs are rejected rather than overwriting drawings, sheets, comments or resources', () => {
  const workbook = createWorkbook();
  for (const commands of [
    [{ type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor }, { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor }],
    [{ type: 'sheets.add', name: 'One' }, { type: 'sheets.add', name: 'Two' }],
    [{ type: 'comments.set', sheetId: 'sheet-1', address: 'A1', comment: { text: 'one' } }, { type: 'comments.set', sheetId: 'sheet-1', address: 'B1', comment: { text: 'two' } }],
    [{ type: 'images.insert', sheetId: 'sheet-1', anchor, resource: imageResource }, { type: 'images.insert', sheetId: 'sheet-1', anchor, resource: imageResource }],
  ]) {
    const result = run(workbook, commands, undefined, () => 'duplicate');
    assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED'); assert.equal(result.commandIndex, 1);
  }
  const badId = run(workbook, [{ type: 'sheets.add' }], undefined, () => 'sheet-1');
  assert.equal(badId.ok, false); assert.equal(badId.code, 'VALIDATION_FAILED');
});

test('command count and sparse-array validation reject before publishing any state', () => {
  const workbook = createWorkbook();
  const excessive = run(workbook, Array.from({ length: MAX_SPREADSHEET_COMMANDS + 1 }, () => ({ type: 'cells.set', sheetId: 'sheet-1', values: {} })));
  assert.equal(excessive.ok, false); assert.equal(excessive.code, 'VALIDATION_FAILED'); assert.equal(excessive.commandIndex, undefined);
  assert.equal(run(workbook, {}).code, 'INVALID_COMMAND');
  const sparse = run(workbook, new Array(1)); assert.equal(sparse.code, 'INVALID_COMMAND'); assert.equal(sparse.commandIndex, 0);
  const threw = stageSpreadsheetCommands(workbook, [{ type: 'sheets.add' }], features, () => { throw new Error('ID source failed'); });
  assert.equal(threw.ok, false); assert.equal(threw.message, 'ID source failed'); assert.equal(threw.commandIndex, 0);
});
