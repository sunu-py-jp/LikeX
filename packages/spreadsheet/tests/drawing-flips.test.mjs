import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { applySpreadsheetCommands: apply, createWorkbook, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  updateDrawing, workbooksEqual, createSpreadsheetSession, copySpreadsheetDrawing, getDrawings, getImages,
  getShapes, getTextBoxes, getDrawingPlacement } = api;
const sheetId = 'sheet-1';
const anchor = { row: 2, column: 2, offsetX: 3, offsetY: 4 };
const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
const kinds = [
  ['images', { resource, alt: 'Picture' }, getImages],
  ['shapes', { shape: 'arrow', text: 'Readable text' }, getShapes],
  ['textBoxes', { text: 'Readable text' }, getTextBoxes],
];
const insert = (kind, fields, flips = {}) => ({ type: `${kind}.insert`, sheetId, anchor, width: 140, height: 80, ...fields, ...flips });
function run(workbook, commands, features) {
  const result = apply(workbook, commands, features ? { features } : undefined);
  assert.equal(result.ok, true, result.message);
  return result;
}
const drawing = workbook => workbook.sheets[0].drawings[0];

test('all drawing kinds store optional reflections, normalize false away and survive JSON and readonly getters', () => {
  for (const [kind, fields, getter] of kinds) {
    for (const flips of [{}, { flipX: false, flipY: false }, { flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
      const created = run(createWorkbook(), [insert(kind, fields, flips)]).workbook;
      const stored = drawing(created);
      assert.equal(stored.flipX, flips.flipX || undefined);
      assert.equal(stored.flipY, flips.flipY || undefined);
      assert.equal(Object.hasOwn(stored, 'flipX'), !!flips.flipX);
      assert.equal(Object.hasOwn(stored, 'flipY'), !!flips.flipY);
      const restored = parseWorkbook(serializeWorkbook(created));
      assert.deepEqual(drawing(restored), stored);
      assert.deepEqual(getter(restored, sheetId)[0], stored);
      assert.deepEqual(getDrawings(restored, sheetId)[0], stored);
      assert.ok(Object.isFrozen(getter(restored, sheetId)[0]));
      assert.deepEqual(stored.anchor, anchor);
      assert.equal(stored.width, 140); assert.equal(stored.height, 80);
    }
  }
});

test('reflection-only updates are real edits while false and omitted flags are equal no-ops', () => {
  for (const [kind, fields] of kinds) {
    const original = run(createWorkbook(), [insert(kind, fields)]).workbook;
    const id = drawing(original).id;
    assert.equal(updateDrawing(original, sheetId, id, { flipX: false, flipY: false }), original);
    const reflected = updateDrawing(original, sheetId, id, { flipX: true, flipY: true });
    assert.notEqual(reflected, original); assert.equal(workbooksEqual(original, reflected), false);
    assert.equal(updateDrawing(reflected, sheetId, id, { flipX: true }), reflected);
    const restored = updateDrawing(reflected, sheetId, id, { flipX: false, flipY: false });
    assert.equal(workbooksEqual(original, restored), true);
    const withFalse = structuredClone(original);
    withFalse.sheets[0].drawings[0].flipX = false;
    withFalse.sheets[0].drawings[0].flipY = false;
    assert.deepEqual(normalizeWorkbook(withFalse), original);
    const command = patch => ({ type: `${kind}.update`, sheetId, drawingId: id, patch });
    assert.equal(run(original, [command({ flipX: false })]).changed, false);
    assert.equal(run(original, [command({ flipX: true }), command({ flipX: false })]).changed, false);
  }
});

test('resize policy blocks reflection changes in either direction and permits unchanged flags and initial placements', () => {
  for (const [kind, fields] of kinds) {
    for (const flipped of [false, true]) {
      const original = run(createWorkbook(), [insert(kind, fields, { flipX: flipped, flipY: flipped })], { resize: false }).workbook;
      const id = drawing(original).id;
      const command = patch => ({ type: `${kind}.update`, sheetId, drawingId: id, patch });
      assert.equal(run(original, [command({ flipX: flipped, flipY: flipped })], { resize: false }).changed, false);
      for (const patch of [{ flipX: !flipped }, { flipY: !flipped }, ...(flipped ? [{ flipX: undefined }, { flipY: undefined }] : [])]) {
        const result = apply(original, [{ type: 'cells.set', sheetId, values: { A1: 'must not be applied' } }, command(patch)], { features: { resize: false } });
        assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED');
        assert.equal(result.commandIndex, 1); assert.equal(original.sheets[0].cells.A1, undefined);
      }
      const unchanged = run(original, [command({ anchor: { row: 3, column: 2 } })], { resize: false });
      assert.equal(!!drawing(unchanged.workbook).flipX, flipped);
      assert.equal(drawing(unchanged.workbook).anchor.row, 3);
    }
  }
});

test('model and command boundaries reject nonboolean flags and unsupported reflection keys', () => {
  for (const [kind, fields] of kinds) {
    const original = run(createWorkbook(), [insert(kind, fields)]).workbook;
    const id = drawing(original).id;
    for (const key of ['flipX', 'flipY']) {
      for (const value of [null, 0, 1, 'false', 'true', {}, []]) {
        assert.throws(() => updateDrawing(original, sheetId, id, { [key]: value }));
        const invalid = structuredClone(original);
        invalid.sheets[0].drawings[0][key] = value;
        assert.throws(() => normalizeWorkbook(invalid));
        for (const command of [insert(kind, fields, { [key]: value }),
          { type: `${kind}.update`, sheetId, drawingId: id, patch: { [key]: value } }]) {
          const result = apply(original, [command]);
          assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND');
        }
      }
    }
    for (const command of [insert(kind, fields, { flipZ: true }),
      { type: `${kind}.update`, sheetId, drawingId: id, patch: { flipZ: true } }]) {
      const result = apply(original, [command]);
      assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND');
    }
  }
});

test('copy and paste retain reflections, text and image resources across sheets without resizing the frame', () => {
  for (const [kind, fields] of kinds) {
    const original = run(createWorkbook(), [insert(kind, fields, { flipX: true, flipY: true }), { type: 'sheets.add', name: 'Copies' }]);
    const source = drawing(original.workbook), destinationId = original.results[1].sheetId;
    const payload = copySpreadsheetDrawing(original.workbook, sheetId, source.id);
    assert.equal(payload.drawing.flipX, true); assert.equal(payload.drawing.flipY, true);
    const pasted = run(original.workbook, [{ type: 'drawings.paste', sheetId: destinationId,
      payload: JSON.parse(JSON.stringify(payload)), anchor: { row: 1, column: 1 } }], { resize: false });
    const copy = pasted.workbook.sheets[1].drawings[0];
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.flipX, true); assert.equal(copy.flipY, true);
    assert.equal(copy.width, source.width); assert.equal(copy.height, source.height);
    if (kind === 'images') assert.deepEqual(pasted.workbook.resources.images[copy.resourceId], resource);
    else assert.equal(copy.text, source.text);
    const badPayload = { ...payload, drawing: { ...payload.drawing, flipZ: true } };
    assert.equal(apply(original.workbook, [{ type: 'drawings.paste', sheetId, payload: badPayload }]).ok, false);
  }
});

test('reflection updates participate in session history and leave drawing placement unchanged', () => {
  const initial = run(createWorkbook(), [insert('shapes', { shape: 'arrow', text: 'Readable text' })]).workbook;
  const id = drawing(initial).id, placement = getDrawingPlacement(initial, sheetId, id);
  const session = createSpreadsheetSession(initial);
  const result = session.execute({ type: 'shapes.update', sheetId, drawingId: id, patch: { flipX: true, flipY: true } });
  assert.equal(result.ok, true); assert.equal(result.changed, true);
  assert.equal(session.getHistoryState().undoCount, 1);
  assert.equal(session.getShape(sheetId, id).flipX, true);
  assert.equal(session.sheet(sheetId).getShapes()[0].flipY, true);
  assert.deepEqual(getDrawingPlacement(session.getWorkbook(), sheetId, id), placement);
  assert.deepEqual(result.results[0].placement, { nextRow: placement.nextRow, nextColumn: placement.nextColumn });
  assert.equal(session.undo(), true); assert.equal(workbooksEqual(session.getWorkbook(), initial), true);
  assert.equal(session.redo(), true); assert.equal(drawing(session.getWorkbook()).flipX, true);
  const noChange = session.execute({ type: 'shapes.update', sheetId, drawingId: id, patch: { flipX: true } });
  assert.equal(noChange.changed, false); assert.equal(session.getHistoryState().undoCount, 1);
});

test('row and column edits and sheet duplication preserve reflection flags', () => {
  const initial = run(createWorkbook(), kinds.map(([kind, fields]) => insert(kind, fields, { flipX: true, flipY: true }))).workbook;
  const changed = run(initial, [
    { type: 'rows.insert', sheetId, index: 1 }, { type: 'columns.insert', sheetId, index: 1 },
    { type: 'rows.delete', sheetId, index: 3 }, { type: 'columns.delete', sheetId, index: 3 },
    { type: 'sheets.duplicate', sheetId },
  ]).workbook;
  for (const sheet of changed.sheets) for (const object of sheet.drawings) {
    assert.equal(object.flipX, true); assert.equal(object.flipY, true);
    assert.equal(object.width, 140); assert.equal(object.height, 80);
  }
});
