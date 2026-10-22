import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1', anchor = { row: 1, column: 1, offsetX: 3, offsetY: 4 };
const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
const picture = fit => ({ id: 'picture', type: 'image', resourceId: 'pixel', alt: 'Sample', anchor, width: 100, height: 200,
  ...(fit !== undefined ? { fit } : {}) });
const book = fit => m.insertImage(m.createWorkbook(), sheetId, 'pixel', resource, picture(fit));
const drawing = workbook => workbook.sheets[0].drawings[0];
const insert = fit => ({ type: 'images.insert', sheetId, resource, anchor, width: 100, height: 200, fit });
const update = (drawingId, fit) => ({ type: 'images.update', sheetId, drawingId, patch: { fit } });

test('image fit preserves explicit fill and contain in SPON and readonly image queries without changing legacy drawings', async () => {
  for (const fit of [undefined, 'contain', 'fill']) {
    const original = book(fit), restored = m.parseWorkbook(m.serializeWorkbook(original));
    assert.deepEqual(drawing(restored), picture(fit));
    assert.equal(m.workbooksEqual(original, restored), true);
    assert.equal(m.getImage(restored, sheetId, 'picture').fit, fit);
    assert.equal((await m.collectSpreadsheetImages(restored)).placements[0].fit, fit);
    if (fit === undefined) assert.equal(Object.hasOwn(drawing(restored), 'fit'), false);
  }
});

test('fit-only updates count as edits while omitted and contain compare as the same default', () => {
  const initial = book(), filled = m.updateDrawing(initial, sheetId, 'picture', { fit: 'fill' });
  assert.equal(drawing(initial).fit, undefined);
  assert.equal(drawing(filled).fit, 'fill');
  assert.equal(m.workbooksEqual(initial, filled), false);
  assert.equal(m.updateDrawing(filled, sheetId, 'picture', { fit: 'fill' }), filled);
  assert.equal(m.updateDrawing(initial, sheetId, 'picture', { fit: 'contain' }), initial);
  assert.equal(m.workbooksEqual(initial, book('contain')), true);
  assert.equal(m.workbooksEqual(initial, m.updateDrawing(filled, sheetId, 'picture', { fit: undefined })), true);
  assert.deepEqual(drawing(filled).anchor, drawing(initial).anchor);
  assert.deepEqual([drawing(filled).width, drawing(filled).height], [100, 200]);
});

test('commands preserve image fit through copies, updates and undo/redo', () => {
  const session = m.createSpreadsheetSession(m.createWorkbook());
  const inserted = session.execute(insert('fill'));
  assert.equal(inserted.ok, true, inserted.message);
  const id = inserted.results[0].drawingId;
  assert.equal(session.getImage(sheetId, id).fit, 'fill');
  const payload = m.copySpreadsheetDrawing(session.getWorkbook(), sheetId, id);
  assert.equal(payload.drawing.fit, 'fill');
  const pasted = session.execute({ type: 'drawings.paste', sheetId, payload: JSON.parse(JSON.stringify(payload)), anchor: { row: 4, column: 4 } });
  assert.equal(pasted.ok, true, pasted.message);
  assert.equal(session.getImage(sheetId, pasted.results[0].drawingId).fit, 'fill');
  session.clearHistory();
  const changed = session.execute(update(id, 'contain'));
  assert.equal(changed.ok, true); assert.equal(changed.changed, true);
  assert.equal(session.getImage(sheetId, id).fit, 'contain');
  assert.equal(session.getHistoryState().undoCount, 1);
  assert.equal(session.undo(), true); assert.equal(session.getImage(sheetId, id).fit, 'fill');
  assert.equal(session.redo(), true); assert.equal(session.getImage(sheetId, id).fit, 'contain');
  assert.equal(session.execute(update(id, undefined)).changed, false);
});

test('invalid fits are rejected by model, native parsing, insertion and update without partial writes', () => {
  const original = book();
  for (const fit of ['cover', '', null, true, 1, {}, []]) {
    const invalid = structuredClone(original); drawing(invalid).fit = fit;
    assert.throws(() => m.normalizeWorkbook(invalid), /contain/);
    const file = JSON.parse(m.serializeWorkbook(original)); file.sheets[0].drawings[0].fit = fit;
    assert.throws(() => m.parseWorkbook(JSON.stringify(file)), /contain/);
    assert.throws(() => book(fit), /contain/);
    assert.throws(() => m.updateDrawing(original, sheetId, 'picture', { fit }), /contain/);
    for (const command of [insert(fit), update('picture', fit)]) {
      const result = m.applySpreadsheetCommands(original, [{ type: 'cells.set', sheetId, values: { A1: 'must not write' } }, command]);
      assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND'); assert.equal(result.commandIndex, 1);
      assert.equal(original.sheets[0].cells.A1, undefined); assert.equal('workbook' in result, false);
    }
  }
});

test('resize restrictions cover fit changes while allowing insertion and equivalent default updates', () => {
  const session = m.createSpreadsheetSession(book(), { features: { resize: false } });
  assert.equal(session.execute(update('picture', 'contain')).changed, false);
  const denied = session.execute(update('picture', 'fill'));
  assert.equal(denied.ok, false); assert.equal(denied.code, 'FEATURE_DISABLED');
  const inserted = session.execute(insert('fill'));
  assert.equal(inserted.ok, true, inserted.message);
  assert.equal(session.getImage(sheetId, inserted.results[0].drawingId).fit, 'fill');
});
