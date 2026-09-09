import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createWorkbook, normalizeWorkbook, serializeWorkbook, parseWorkbook, workbooksEqual, addDrawing, updateDrawing,
  deleteDrawing, insertImage, setCellComment, setCellComments, setCellValue, formatCells, resizeColumn, insertRows,
  deleteRows, insertColumns, deleteColumns, addSheet, renameSheet, deleteSheet, moveCells, SPREADSHEET_LIMITS } = model;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const image = (bytes = png, mimeType = 'image/png', width = 1, height = 1) => ({ name: 'sample.png', mimeType,
  dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, width, height });
const anchor = { row: 1, column: 1, offsetX: 3, offsetY: 4 };
const shape = (id = 'shape') => ({ id, type: 'shape', shape: 'rectangle', anchor: { ...anchor }, width: 120, height: 80,
  fill: 'transparent', stroke: '#217346', strokeWidth: 2 });
const textbox = (id = 'text') => ({ id, type: 'text', anchor: { ...anchor }, width: 180, height: 100,
  text: '<script>not executable</script>\nこんにちは', color: '#123', background: 'transparent', fontSize: 16, bold: true });
const picture = (id = 'picture', resourceId = 'image') => ({ id, type: 'image', resourceId, alt: '説明', anchor: { ...anchor }, width: 160, height: 120 });
const first = wb => wb.sheets[0].id;
function populated() {
  let wb = createWorkbook(); const id = first(wb);
  wb = insertImage(wb, id, 'image', image(), picture());
  wb = addDrawing(wb, id, shape()); wb = addDrawing(wb, id, textbox());
  wb = setCellComment(wb, id, 'b2', { id: 'comment', text: 'ここを確認', author: '利用者' });
  return setCellValue(wb, id, 'B2', '=1+2');
}

test('complete JSON roundtrip keeps images, ordered drawings, comments and old sheets-only input', () => {
  const wb = populated(), json = serializeWorkbook(wb), restored = parseWorkbook(json);
  assert.equal(wb.schemaVersion, 1); assert.ok(workbooksEqual(wb, restored));
  assert.deepEqual(restored, normalizeWorkbook(wb)); assert.equal(restored.resources.images.image.dataUrl, image().dataUrl);
  assert.deepEqual(restored.sheets[0].drawings.map(item => item.type), ['image', 'shape', 'text']);
  assert.equal(restored.sheets[0].comments.B2.id, 'comment');
  assert.equal(parseWorkbook(JSON.stringify({ sheets: createWorkbook().sheets })).schemaVersion, 1);
});

test('normalization clones and freezes all annotation boundaries without exposing host references', () => {
  const source = JSON.parse(serializeWorkbook(populated())), wb = normalizeWorkbook(source);
  source.resources.images.image.name = 'changed'; source.sheets[0].drawings[0].anchor.row = 8;
  source.sheets[0].comments.B2.text = 'changed';
  assert.equal(wb.resources.images.image.name, 'sample.png'); assert.equal(wb.sheets[0].drawings[0].anchor.row, 1);
  assert.equal(wb.sheets[0].comments.B2.text, 'ここを確認');
  for (const value of [wb.resources, wb.resources.images, wb.resources.images.image, wb.sheets[0].drawings,
    wb.sheets[0].drawings[0], wb.sheets[0].drawings[0].anchor, wb.sheets[0].comments, wb.sheets[0].comments.B2]) assert.ok(Object.isFrozen(value));
});

test('cell edits and sheet operations preserve resources and annotations without decoding images again', t => {
  let wb = populated(); const id = first(wb), resources = wb.resources, drawing = wb.sheets[0].drawings[0];
  const decode = t.mock.method(globalThis, 'atob', () => { throw new Error('unexpected repeated image decoding'); });
  wb = setCellValue(wb, id, 'A1', '42'); wb = formatCells(wb, id, ['A1'], { bold: true }); wb = resizeColumn(wb, id, 0, 150);
  wb = addSheet(wb); wb = renameSheet(wb, id, 'New'); wb = insertRows(wb, id, 0); wb = deleteRows(wb, id, 0);
  wb = insertColumns(wb, id, 0); wb = deleteColumns(wb, id, 0);
  wb = deleteSheet(wb, wb.sheets[1].id); normalizeWorkbook(wb);
  assert.equal(decode.mock.callCount(), 0); assert.equal(wb.resources, resources);
  assert.deepEqual(wb.sheets[0].drawings[0], drawing); assert.equal(wb.sheets[0].comments.B2.id, 'comment');
});

test('drawing updates preserve identity/type, ordering, immutable snapshots and no-op references', () => {
  const wb = populated(), id = first(wb), updated = updateDrawing(wb, id, 'shape', { width: 240, fill: '#ffc' });
  assert.equal(wb.sheets[0].drawings[1].width, 120); assert.equal(updated.sheets[0].drawings[1].width, 240);
  assert.equal(updated.sheets[0].drawings[0], wb.sheets[0].drawings[0]);
  assert.equal(updateDrawing(updated, id, 'shape', { width: 240, anchor: { ...anchor } }), updated);
  assert.equal(deleteDrawing(wb, id, 'not-found'), wb);
  assert.throws(() => updateDrawing(wb, id, 'shape', { id: 'other' }));
  assert.throws(() => updateDrawing(wb, id, 'shape', { type: 'text' }));
  assert.throws(() => addDrawing(wb, id, shape()));
});

test('image resources survive while referenced and are removed after their last drawing or sheet disappears', () => {
  let wb = addSheet(populated()); const id = first(wb), second = wb.sheets[1].id;
  wb = addDrawing(wb, second, picture('shared'));
  const resources = wb.resources;
  wb = deleteDrawing(wb, id, 'picture'); assert.equal(wb.resources, resources);
  wb = deleteSheet(wb, second); assert.equal(wb.resources, undefined);
  const single = deleteDrawing(populated(), id, 'picture'); assert.equal(single.resources, undefined);
});

test('image insertion is atomic and cannot replace a shared resource through its ID', () => {
  const wb = populated(), id = first(wb);
  assert.throws(() => insertImage(wb, id, 'image', { ...image(), name: 'other' }, picture('another')));
  assert.throws(() => insertImage(wb, id, 'different', image(), picture('another')));
  assert.throws(() => insertImage(wb, id, 'new', image(), picture('picture', 'new')));
  assert.deepEqual(Object.keys(wb.resources.images), ['image']);
  const reused = insertImage(wb, id, 'image', image(), picture('another'));
  assert.equal(reused.sheets[0].drawings.length, 4);
});

test('comment batches validate atomically, canonicalize addresses, retain stable IDs and skip unchanged data', () => {
  const wb = populated(), id = first(wb), comment = { ...wb.sheets[0].comments.B2 };
  assert.equal(setCellComment(wb, id, 'B2', comment), wb);
  assert.equal(setCellComment(wb, id, 'A1', null), wb);
  const changed = setCellComments(wb, id, { B2: null, a1: comment, C3: { id: 'another', text: 'second' } });
  assert.deepEqual(Object.keys(changed.sheets[0].comments), ['A1', 'C3']); assert.equal(changed.sheets[0].comments.A1.id, 'comment');
  assert.throws(() => setCellComments(wb, id, { A1: { id: 'new', text: 'a' }, A9999: comment }));
  assert.throws(() => setCellComment(wb, id, 'A1', comment));
  assert.equal(wb.sheets[0].comments.A1, undefined);
});

test('row and column insertions move comments and anchors; removed anchors clamp while removed comments disappear', () => {
  let wb = populated(), id = first(wb);
  wb = insertRows(wb, id, 1, 2); wb = insertColumns(wb, id, 1, 3);
  assert.equal(wb.sheets[0].comments.E4.id, 'comment');
  assert.deepEqual(wb.sheets[0].drawings[0].anchor, { row: 3, column: 4, offsetX: 3, offsetY: 4 });
  wb = deleteRows(wb, id, 3, 2); wb = deleteColumns(wb, id, 4, 2);
  assert.equal(Object.keys(wb.sheets[0].comments).length, 0);
  assert.deepEqual(wb.sheets[0].drawings[0].anchor, { row: 3, column: 4, offsetX: 3, offsetY: 4 });
  wb = updateDrawing(wb, id, 'picture', { anchor: { row: wb.sheets[0].rowCount - 1, column: wb.sheets[0].columnCount - 1, offsetX: 0, offsetY: 0 } });
  wb = deleteRows(wb, id, wb.sheets[0].rowCount - 1); wb = deleteColumns(wb, id, wb.sheets[0].columnCount - 1);
  assert.equal(wb.sheets[0].drawings[0].anchor.row, wb.sheets[0].rowCount - 1);
  assert.equal(wb.sheets[0].drawings[0].anchor.column, wb.sheets[0].columnCount - 1);
  assert.ok(wb.resources.images.image);
});

test('cell cut follows comments across sheets and clears target comments for blank source cells', () => {
  let wb = addSheet(populated()); const id = first(wb), target = wb.sheets[1].id;
  wb = setCellComments(wb, target, { D4: { id: 'old', text: 'old' }, E4: { id: 'blank-destination', text: 'old' } });
  const result = moveCells(wb, { sheetId: id, top: 1, left: 1, bottom: 1, right: 2 }, { sheetId: target, row: 3, column: 3 });
  assert.equal(result.sheets[0].comments.B2, undefined); assert.equal(result.sheets[1].comments.D4.id, 'comment');
  assert.equal(result.sheets[1].comments.E4, undefined); assert.equal(result.sheets[0].drawings, wb.sheets[0].drawings);
  assert.equal(wb.sheets[0].comments.B2.text, 'ここを確認');
});

test('overlapping comment cut reads the source snapshot and same-address cut is a no-op', () => {
  let wb = createWorkbook(); const id = first(wb);
  wb = setCellComments(wb, id, { A1: { id: 'a', text: 'a' }, B1: { id: 'b', text: 'b' }, C1: { id: 'c', text: 'c' } });
  const source = { sheetId: id, top: 0, left: 0, bottom: 0, right: 1 };
  assert.equal(moveCells(wb, source, { sheetId: id, row: 0, column: 0 }), wb);
  const moved = moveCells(wb, source, { sheetId: id, row: 0, column: 1 });
  assert.equal(moved.sheets[0].comments.A1, undefined); assert.equal(moved.sheets[0].comments.B1.id, 'a'); assert.equal(moved.sheets[0].comments.C1.id, 'b');
});

test('equality detects image data, comments, drawing geometry and z-order while ignoring record order', () => {
  const wb = populated(), id = first(wb);
  assert.equal(workbooksEqual(wb, parseWorkbook(serializeWorkbook(wb))), true);
  assert.equal(workbooksEqual(wb, updateDrawing(wb, id, 'picture', { alt: 'changed' })), false);
  assert.equal(workbooksEqual(wb, updateDrawing(wb, id, 'shape', { anchor: { ...anchor, row: 3 } })), false);
  assert.equal(workbooksEqual(wb, setCellComment(wb, id, 'B2', { id: 'comment', text: 'changed' })), false);
  const reordered = normalizeWorkbook({ ...wb, sheets: [{ ...wb.sheets[0], drawings: [...wb.sheets[0].drawings].reverse() }] });
  assert.equal(workbooksEqual(wb, reordered), false);
  const renamed = normalizeWorkbook({ ...wb, resources: { images: { image: { ...image(), name: 'renamed.png' } } } });
  assert.equal(workbooksEqual(wb, renamed), false);
});

test('image payloads reject remote URLs, SVG/HTML, wrong MIME, invalid base64 and forged dimensions', () => {
  const wb = createWorkbook(), id = first(wb), raw = image();
  for (const resource of [{ ...raw, dataUrl: 'https://example.com/image.png' }, { ...raw, mimeType: 'image/svg+xml' },
    { ...raw, dataUrl: 'data:image/png;base64,PHN2Zy8+' }, { ...raw, mimeType: 'image/jpeg' },
    { ...raw, dataUrl: raw.dataUrl + '\n' }, { ...raw, dataUrl: 'data:image/png;base64,====' },
    { ...raw, width: 2 }, { ...raw, height: 0 }, image(png.subarray(0, 20))])
    assert.throws(() => insertImage(wb, id, 'image', resource, picture()));
  for (const [width, height] of [[0, 1], [10_001, 1], [5000, 5000]]) {
    const bytes = Buffer.from(png); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    assert.throws(() => insertImage(wb, id, 'image', image(bytes, 'image/png', width, height), picture()));
  }
  assert.equal(wb.resources, undefined);
});

test('supported GIF, JPEG and WebP headers are checked against the declared dimensions', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 3, 0, 2, 1]);
  const webp = Buffer.from('524946461a000000574542505650384c0d0000002f00000000071011118888fe0700', 'hex');
  for (const [bytes, mime, width, height] of [[gif, 'image/gif', 1, 1], [jpeg, 'image/jpeg', 2, 3], [webp, 'image/webp', 1, 1]]) {
    const wb = createWorkbook();
    assert.equal(insertImage(wb, first(wb), 'image', image(bytes, mime, width, height), picture()).resources.images.image.width, width);
  }
});

test('per-image and aggregate embedded byte limits are enforced even for reused immutable resources', () => {
  const bytes = Buffer.alloc(SPREADSHEET_LIMITS.imageBytes); png.copy(bytes);
  const wb = createWorkbook(), resource = image(bytes);
  const normalized = insertImage(wb, first(wb), 'image', resource, picture()).resources.images.image;
  assert.throws(() => normalizeWorkbook({ ...wb, resources: { images: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index), normalized])) } }), /20 MiB/);
  const oversized = Buffer.alloc(SPREADSHEET_LIMITS.imageBytes + 1); png.copy(oversized);
  assert.throws(() => insertImage(wb, first(wb), 'image', image(oversized), picture()));
});

test('invalid object identities, anchors, sizes, paint URLs, comments and dangling image references are rejected', () => {
  const wb = createWorkbook(), id = first(wb);
  for (const drawing of [{ ...shape(), id: '' }, { ...shape(), anchor: { ...anchor, row: -1 } },
    { ...shape(), anchor: { ...anchor, column: 26 } }, { ...shape(), anchor: { ...anchor, offsetX: NaN } },
    { ...shape(), width: 0 }, { ...shape(), height: Infinity }, { ...shape(), fill: 'url(https://example.com/paint)' },
    { ...shape(), stroke: 'var(--unsafe)' }, { ...shape(), shape: 'script' }, { ...textbox(), bold: 'yes' }, picture()])
    assert.throws(() => addDrawing(wb, id, drawing));
  assert.throws(() => setCellComment(wb, id, 'A1', { id: 'x', text: 'x'.repeat(SPREADSHEET_LIMITS.commentLength + 1) }));
  assert.throws(() => normalizeWorkbook({ ...wb, sheets: [{ ...wb.sheets[0], drawings: [shape(), shape()] }] }));
  assert.throws(() => normalizeWorkbook({ ...wb, sheets: [{ ...wb.sheets[0], comments: { a1: { id: 'a', text: '' }, A1: { id: 'b', text: '' } } }] }));
});

test('JSON loading rejects malformed input and future schemas, and both directions enforce serialized size', () => {
  for (const value of ['{', 'null', '[]', '{"schemaVersion":2,"sheets":[]}', JSON.stringify({ ...createWorkbook(), schemaVersion: 2 })]) assert.throws(() => parseWorkbook(value));
  assert.throws(() => parseWorkbook(' '.repeat(SPREADSHEET_LIMITS.serializedCharacters + 1)), /64/);
  const wb = createWorkbook(), cells = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [`A${index + 1}`, { value: 'x'.repeat(100_000) }]));
  assert.throws(() => serializeWorkbook({ sheets: [{ ...wb.sheets[0], rowCount: 1000, cells }] }), /64/);
});

test('repointing an image prunes its old resource only after the reference changes', () => {
  let wb = populated(); const id = first(wb);
  wb = normalizeWorkbook({ ...wb, resources: { images: { ...wb.resources.images, replacement: { ...image(), name: 'replacement' } } } });
  const result = updateDrawing(wb, id, 'picture', { resourceId: 'replacement' });
  assert.equal(result.resources.images.image, undefined); assert.equal(result.resources.images.replacement.name, 'replacement');
  assert.ok(wb.resources.images.image); assert.throws(() => updateDrawing(wb, id, 'picture', { resourceId: 'missing' }));
});

test('annotation counts are bounded across sheets and sparse drawing arrays are rejected', () => {
  const wb = createWorkbook(), id = first(wb);
  const full = normalizeWorkbook({ ...wb, sheets: [{ ...wb.sheets[0], drawings: Array.from({ length: SPREADSHEET_LIMITS.drawings }, (_, index) => shape(`s${index}`)) }] });
  const second = addSheet(full);
  assert.throws(() => addDrawing(second, second.sheets[1].id, shape('overflow')), /上限/);
  assert.throws(() => normalizeWorkbook({ ...wb, sheets: [{ ...wb.sheets[0], drawings: new Array(1) }] }));
  assert.equal(setCellComments(wb, id, {}), wb);
});

test('a comment ID conflict during cross-sheet cut rejects the entire operation', () => {
  let wb = addSheet(populated()); const id = first(wb), second = wb.sheets[1].id;
  wb = setCellComment(wb, second, 'A1', { id: 'comment', text: 'another location' });
  assert.throws(() => moveCells(wb, { sheetId: id, top: 1, left: 1, bottom: 1, right: 1 }, { sheetId: second, row: 4, column: 4 }), /同じ ID/);
  assert.equal(wb.sheets[0].comments.B2.id, 'comment'); assert.equal(wb.sheets[1].comments.E5, undefined);
});
