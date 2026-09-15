import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './model-entry';
  export { prepareWorksheetDrawings } from './export/xlsx/drawings';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, createWorkbook, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  updateDrawing, workbooksEqual, createSpreadsheetSession, copySpreadsheetDrawing, getImages, getShapes, getTextBoxes,
  getDrawingBounds, getDrawingPlacement, prepareWorksheetDrawings } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const anchor = { row: 2, column: 1, offsetX: 10, offsetY: 20 };
const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
const kinds = [
  ['images', { resource, alt: 'Rotated image' }, getImages],
  ['shapes', { shape: 'rightArrow', text: '回転した図形' }, getShapes],
  ['textBoxes', { text: '回転した文字' }, getTextBoxes],
];
const insert = (kind, fields, props = {}) => ({ type: `${kind}.insert`, sheetId, anchor,
  width: 120, height: 60, ...fields, ...props });
function run(workbook, commands, features) {
  const result = apply(workbook, commands, features ? { features } : undefined);
  assert.equal(result.ok, true, result.message);
  return result;
}
const drawing = book => book.sheets[0].drawings[0];

test('every drawing kind normalizes clockwise degrees and preserves rotation in JSON and readonly queries', () => {
  for (const [kind, fields, getter] of kinds) {
    for (const [rotation, expected] of [[undefined, undefined], [0, undefined], [-0, undefined], [720, undefined],
      [450, 90], [-90, 270], [22.5, 22.5]]) {
      const book = run(createWorkbook(), [insert(kind, fields, { rotation })]).workbook;
      assert.equal(drawing(book).rotation, expected);
      assert.equal(Object.hasOwn(drawing(book), 'rotation'), expected !== undefined);
      const restored = parseWorkbook(serializeWorkbook(book));
      assert.deepEqual(drawing(restored), drawing(book));
      assert.deepEqual(getter(restored, sheetId)[0], drawing(book));
      assert.ok(Object.isFrozen(getter(restored, sheetId)[0]));
    }
  }
});

test('rotation-only updates are edits, equivalent angles are no-ops, and zero clears the field', () => {
  for (const [kind, fields] of kinds) {
    const initial = run(createWorkbook(), [insert(kind, fields)]).workbook, id = drawing(initial).id;
    assert.equal(updateDrawing(initial, sheetId, id, { rotation: 360 }), initial);
    const rotated = updateDrawing(initial, sheetId, id, { rotation: -90 });
    assert.equal(drawing(rotated).rotation, 270);
    assert.equal(workbooksEqual(initial, rotated), false);
    assert.equal(updateDrawing(rotated, sheetId, id, { rotation: 630 }), rotated);
    assert.equal(workbooksEqual(initial, updateDrawing(rotated, sheetId, id, { rotation: 0 })), true);
    const result = run(rotated, [{ type: `${kind}.update`, sheetId, drawingId: id, patch: { rotation: -90 } }]);
    assert.equal(result.changed, false);
  }
});

test('invalid rotations are rejected by JSON, model and commands without partially applying batches', () => {
  for (const [kind, fields] of kinds) {
    const initial = run(createWorkbook(), [insert(kind, fields)]).workbook, drawingId = drawing(initial).id;
    for (const rotation of [NaN, Infinity, -Infinity, null, '90', true, {}, []]) {
      const malformed = structuredClone(initial); malformed.sheets[0].drawings[0].rotation = rotation;
      assert.throws(() => normalizeWorkbook(malformed));
      assert.throws(() => updateDrawing(initial, sheetId, drawingId, { rotation }));
      for (const command of [insert(kind, fields, { rotation }), { type: `${kind}.update`, sheetId, drawingId, patch: { rotation } }]) {
        const result = apply(initial, [{ type: 'cells.set', sheetId, values: { A1: 'must not write' } }, command]);
        assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND', `${kind} ${command.type} ${String(rotation)}`);
        assert.equal(initial.sheets[0].cells.A1, undefined);
      }
    }
  }
});

test('resize feature restrictions cover rotation while allowing initial angles and equivalent updates', () => {
  for (const [kind, fields] of kinds) {
    const initial = run(createWorkbook(), [insert(kind, fields, { rotation: 90 })], { resize: false }).workbook;
    const drawingId = drawing(initial).id;
    const update = rotation => ({ type: `${kind}.update`, sheetId, drawingId, patch: { rotation } });
    assert.equal(run(initial, [update(450)], { resize: false }).changed, false);
    for (const angle of [0, undefined, 180]) {
      const result = apply(initial, [{ type: 'cells.set', sheetId, values: { A1: 'must not write' } }, update(angle)], { features: { resize: false } });
      assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED');
      assert.equal(result.commandIndex, 1); assert.equal(initial.sheets[0].cells.A1, undefined);
    }
  }
});

test('copy across sheets and session undo/redo preserve rotation, reflections and resource identities', () => {
  for (const [kind, fields] of kinds) {
    const initial = run(createWorkbook(), [insert(kind, fields, { rotation: 30, flipX: true }), { type: 'sheets.add', name: 'Copies' }]);
    const source = drawing(initial.workbook), destination = initial.results[1].sheetId;
    const payload = copySpreadsheetDrawing(initial.workbook, sheetId, source.id);
    const pasted = run(initial.workbook, [{ type: 'drawings.paste', sheetId: destination,
      payload: JSON.parse(JSON.stringify(payload)), anchor: { row: 3, column: 3 } }], { resize: false });
    const copied = pasted.workbook.sheets[1].drawings[0];
    assert.notEqual(copied.id, source.id); assert.equal(copied.rotation, 30); assert.equal(copied.flipX, true);
    assert.equal(copied.width, source.width); assert.equal(copied.height, source.height);
    if (kind === 'images') assert.deepEqual(pasted.workbook.resources.images[copied.resourceId], resource);
    else assert.equal(copied.text, source.text);
    const session = createSpreadsheetSession(initial.workbook);
    const edit = session.execute({ type: `${kind}.update`, sheetId, drawingId: source.id, patch: { rotation: 135 } });
    assert.equal(edit.ok, true); assert.equal(edit.changed, true);
    assert.equal(drawing(session.getWorkbook()).rotation, 135);
    assert.equal(session.undo(), true); assert.equal(drawing(session.getWorkbook()).rotation, 30);
    assert.equal(session.redo(), true); assert.equal(drawing(session.getWorkbook()).rotation, 135);
  }
});

test('placement uses the rotated visual bounds without changing the saved anchor and dimensions', () => {
  const initial = run(createWorkbook(), [insert('shapes', { shape: 'rightArrow' }, { rotation: 90 })]);
  const book = initial.workbook, id = drawing(book).id;
  assert.deepEqual(drawing(book).anchor, anchor);
  assert.equal(drawing(book).width, 120); assert.equal(drawing(book).height, 60);
  assert.deepEqual(getDrawingBounds(book, sheetId, id), { left: 140, top: 46, width: 60, height: 120, right: 200, bottom: 166 });
  assert.deepEqual(initial.results[0].placement, { nextRow: 6, nextColumn: 2 });
  assert.equal(getDrawingPlacement(book, sheetId, id).nextRow, 6);
  const diagonal = updateDrawing(book, sheetId, id, { rotation: 45 });
  const bounds = getDrawingBounds(diagonal, sheetId, id), diagonalSize = 180 / Math.sqrt(2);
  assert.ok(Math.abs(bounds.width - diagonalSize) < 1e-9);
  assert.ok(Math.abs(bounds.height - diagonalSize) < 1e-9);
  assert.ok(Math.abs(bounds.left + bounds.width / 2 - 170) < 1e-9);
  assert.ok(Math.abs(bounds.top + bounds.height / 2 - 106) < 1e-9);
  assert.equal(getDrawingPlacement(diagonal, sheetId, id, { gap: 8 }).nextRow, 7);
  assert.equal(getDrawingPlacement(diagonal, sheetId, id, { gap: 8 }).nextColumn, 3);
});

test('Excel serializes native rotation with original frame size and lets shape text follow the angle', async () => {
  for (const [kind, fields] of kinds) {
    const baselineBook = run(createWorkbook(), [insert(kind, fields)]).workbook;
    const baselineExport = await prepareWorksheetDrawings(baselineBook.sheets[0], baselineBook.resources, { sheetIndex: 1 });
    const baselineXml = await baselineExport.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
    const originalExtent = baselineXml.match(/<a:ext cx="\d+" cy="\d+"\/>/)[0];
    for (const rotation of [90, 22.5, 0]) {
      const book = run(createWorkbook(), [insert(kind, fields, { rotation, flipX: true, flipY: true })]).workbook;
      const exported = await prepareWorksheetDrawings(book.sheets[0], book.resources, { sheetIndex: 1 });
      const xml = await exported.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
      if (rotation) assert.match(xml, new RegExp(`<a:xfrm[^>]*rot="${rotation * 60000}"`));
      else assert.doesNotMatch(xml, /rot="/);
      assert.match(xml, /flipH="1"/); assert.match(xml, /flipV="1"/);
      // Preserve the existing image containment and shape stroke inset, without exporting an AABB.
      assert.equal(xml.match(/<a:ext cx="\d+" cy="\d+"\/>/)[0], originalExtent);
      if (kind !== 'images') {
        assert.match(xml, new RegExp(`upright="${rotation ? '0' : '1'}"`));
        if (rotation) assert.match(xml, /<a:bodyPr[^>]*rot="10800000"/);
      }
    }
  }
});
