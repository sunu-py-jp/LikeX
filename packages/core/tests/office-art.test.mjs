import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { artRecord, artContainer, shapeHeader, artProperties, groupBounds, childAnchor, utf16, pngBlip, jpegBlip, blip, blipEntry, SHAPE, PNG, JPEG } from './office-art-fixture.mjs';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `export * from './legacy-office.ts';` }, bundle: true, platform: 'node', format: 'esm', write: false });
const art = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const join = (...parts) => Uint8Array.from(parts.flatMap(part => [...part]));
const only = bytes => art.officeArtRecords(bytes)[0];

test('sibling records are listed with their version, instance, type and payload range', () => {
  const bytes = join(artRecord(2, 0x123, 0xf00a, [1, 2, 3, 4]), artRecord(15, 0, 0xf004), artRecord(0, 1, 0xf010, [9]));
  assert.deepEqual(art.officeArtRecords(bytes), [{ version: 2, instance: 0x123, type: 0xf00a, start: 8, end: 12 }, { version: 15, instance: 0, type: 0xf004, start: 20, end: 20 },
    { version: 0, instance: 1, type: 0xf010, start: 28, end: 29 }]);
});

test('a record that claims more bytes than its range ends the list', () => {
  const bytes = join(artRecord(0, 0, 0xf010, [1]), artRecord(0, 0, 0xf011, [1, 2, 3]));
  assert.equal(art.officeArtRecords(bytes.subarray(0, bytes.length - 1)).length, 1);
  assert.equal(art.officeArtRecords(bytes, 0, 9).length, 1);
  assert.deepEqual(art.officeArtRecords(new Uint8Array(5)), []);
});

test('a single record is read at an offset without listing the records after it', () => {
  const bytes = join(artRecord(0, 0, 0xf010, [1]), artRecord(3, 7, 0xf011, [1, 2, 3]), artRecord(0, 0, 0xf012));
  assert.deepEqual(art.officeArtRecordAt(bytes, 9), { version: 3, instance: 7, type: 0xf011, start: 17, end: 20 });
  assert.deepEqual(art.officeArtRecordAt(bytes, 20), { version: 0, instance: 0, type: 0xf012, start: 28, end: 28 });
  // Outside the range, cut short, or not a whole offset: no record.
  for (const [offset, end] of [[9, 19], [21, undefined], [-1, undefined], [1.5, undefined], [0, bytes.length + 1]]) assert.equal(art.officeArtRecordAt(bytes, offset, end), undefined, `${offset}/${end}`);
  assert.equal(art.officeArtRecordAt(bytes.subarray(9), 0).type, 0xf011, 'offsets are relative to the view');
});

test('PNG and JPEG pictures are extracted with one or two identifiers', () => {
  for (const twoIds of [false, true]) {
    assert.deepEqual(art.readOfficeArtImage(pngBlip(PNG, twoIds), only(pngBlip(PNG, twoIds))), { format: 'png', data: PNG });
    assert.deepEqual(art.readOfficeArtImage(jpegBlip(JPEG, twoIds), only(jpegBlip(JPEG, twoIds))), { format: 'jpeg', data: JPEG });
  }
});

test('metafiles and bitmaps are identified; pictures without their signature are refused', () => {
  const metafile = blip(0xf01a, 0x3d4, new Array(40).fill(1));
  assert.deepEqual(art.readOfficeArtImage(metafile, only(metafile)), { format: 'emf', data: new Uint8Array() });
  const bitmap = blip(0xf01f, 0x7a8, [40, 0, 0, 0, 1, 2, 3]);
  assert.deepEqual(art.readOfficeArtImage(bitmap, only(bitmap)), { format: 'dib', data: Uint8Array.from([40, 0, 0, 0, 1, 2, 3]) });
  const fake = pngBlip([1, 2, 3, 4, 5]);
  assert.equal(art.readOfficeArtImage(fake, only(fake)), undefined);
  assert.equal(art.readOfficeArtImage(artRecord(0, 0, 0xf010, [1]), only(artRecord(0, 0, 0xf010, [1]))), undefined);
});

test('a store entry yields its embedded picture or the one it points to in the delay stream', () => {
  const embedded = blipEntry({ embedded: pngBlip(PNG), name: [0x41, 0] });
  assert.deepEqual(art.readOfficeArtImage(embedded, only(embedded)), { format: 'png', data: PNG });
  const delay = join(new Uint8Array(10), jpegBlip(JPEG)), pointer = blipEntry({ size: JPEG.length + 25, delayOffset: 10 });
  assert.deepEqual(art.readOfficeArtImage(pointer, only(pointer), delay), { format: 'jpeg', data: JPEG });
  assert.equal(art.readOfficeArtImage(pointer, only(pointer)), undefined);
  const empty = blipEntry({ size: 0, delayOffset: 10 });
  assert.equal(art.readOfficeArtImage(empty, only(empty), delay), undefined);
  const outside = blipEntry({ size: 100, delayOffset: 9999 });
  assert.equal(art.readOfficeArtImage(outside, only(outside), delay), undefined);
});

test('the pictures of a drawing group are returned in store order', () => {
  const group = artContainer(0xf000, artRecord(0, 0, 0xf006, new Array(16).fill(0)), artContainer(0xf001, blipEntry({ embedded: pngBlip(PNG) }), blipEntry({}), blipEntry({ embedded: jpegBlip(JPEG) })));
  assert.deepEqual(art.readOfficeArtImages(group, only(group)).map(image => image?.format), ['png', undefined, 'jpeg']);
  assert.deepEqual(art.readOfficeArtImages(artContainer(0xf000), only(artContainer(0xf000))), []);
});

const shape = (id, type, flags, ...rest) => artContainer(0xf004, shapeHeader(id, type, flags), ...rest);

test('a shape exposes its header flags, property table and host records', () => {
  const properties = artProperties([[0x0004, 45 << 16], [0x0181, 0x00123456], [0x0104, 2, 'blip'], [0x0380, utf16('図形 1')], [0x0381, utf16('説明')]]);
  const bytes = shape(1026, 3, SHAPE.hasAnchor | SHAPE.hasType | SHAPE.flipHorizontal, properties, artRecord(0, 0, 0xf010, [1, 2, 3, 4, 5, 6, 7, 8]), artRecord(15, 0, 0xf011), artRecord(15, 0, 0xf00d));
  const read = art.readOfficeArtShape(bytes, only(bytes));
  assert.deepEqual([read.id, read.shapeType, read.flipHorizontal, read.flipVertical, read.group, read.connector], [1026, 3, true, false, false, false]);
  assert.equal(read.properties.get(art.OFFICE_ART_PROPERTY.rotation).value, 45 << 16);
  assert.equal(read.properties.get(art.OFFICE_ART_PROPERTY.picture).value, 2);
  assert.equal(art.officeArtString(read, art.OFFICE_ART_PROPERTY.name), '図形 1');
  assert.equal(art.officeArtString(read, art.OFFICE_ART_PROPERTY.description), '説明');
  assert.equal(art.officeArtString(read, 0x0999), undefined);
  assert.equal(read.clientAnchor.end - read.clientAnchor.start, 8);
  assert.ok(read.clientData && read.clientTextbox);
});

test('a truncated property table keeps the entries read before the damage', () => {
  const table = artProperties([[0x0181, 0x00ff0000], [0x0380, utf16('name')]]), bytes = shape(1, 1, SHAPE.hasType, table.subarray(0, table.length - 4));
  bytes.set([table.length - 4 - 8, 0, 0, 0], 8 + 16 + 4);
  const fixed = Uint8Array.from(bytes); new DataView(fixed.buffer).setUint32(4, fixed.length - 8, true);
  const read = art.readOfficeArtShape(fixed, only(fixed));
  assert.equal(read.properties.get(0x0181).value, 0x00ff0000);
});

test('groups nest, with their coordinate system and child positions', () => {
  const inner = artContainer(0xf003, shape(10, 0, SHAPE.group | SHAPE.child, groupBounds(0, 0, 100, 100), childAnchor(10, 10, 60, 60)), shape(11, 1, SHAPE.child | SHAPE.hasType, childAnchor(0, 0, 50, 50)));
  const root = artContainer(0xf003, shape(1, 0, SHAPE.group | SHAPE.patriarch, groupBounds(0, 0, 1000, 800)), shape(2, 3, SHAPE.hasType, childAnchor(1, 2, 3, 4)), inner);
  const group = art.readOfficeArtGroup(root, only(root));
  assert.deepEqual([group.id, group.patriarch, group.groupBounds], [1, true, { left: 0, top: 0, right: 1000, bottom: 800 }]);
  assert.deepEqual(group.children.map(child => [child.id, child.group, child.childAnchor]), [[2, false, { left: 1, top: 2, right: 3, bottom: 4 }], [10, true, { left: 10, top: 10, right: 60, bottom: 60 }]]);
  assert.deepEqual(group.children[1].children.map(child => child.id), [11]);
  const drawing = artContainer(0xf002, artRecord(0, 1, 0xf008, new Array(8).fill(0)), root, shape(99, 1, SHAPE.background | SHAPE.hasType));
  const read = art.readOfficeArtDrawing(drawing, only(drawing));
  assert.equal(read.root.id, 1);
  assert.deepEqual([read.background.id, read.background.background], [99, true]);
});

test('group nesting is bounded', () => {
  let nested = artContainer(0xf003, shape(1, 0, SHAPE.group));
  for (let depth = 0; depth < 40; depth++) nested = artContainer(0xf003, shape(depth + 2, 0, SHAPE.group), nested);
  let group = art.readOfficeArtGroup(nested, only(nested)), levels = 1;
  while (group.children.length) { group = group.children[0]; levels++; }
  assert.ok(levels <= 34);
});

test('boolean properties apply only when their use bit is set', () => {
  const read = flags => art.readOfficeArtShape(shape(1, 1, SHAPE.hasType, artProperties([[0x01bf, flags]])), only(shape(1, 1, SHAPE.hasType, artProperties([[0x01bf, flags]]))));
  assert.equal(art.officeArtFlag(read(0x00100010), 0x01bf, 0x10, false), true);
  assert.equal(art.officeArtFlag(read(0x00100000), 0x01bf, 0x10, true), false);
  assert.equal(art.officeArtFlag(read(0x00000010), 0x01bf, 0x10, false), false, 'the value bit alone is not in force');
  assert.equal(art.officeArtFlag(read(0), 0x01ff, 0x08, true), true, 'a missing property keeps the default');
});

test('colours are RGB, scheme indexes or system indexes', () => {
  assert.deepEqual(art.officeArtColor(0x00563412), { rgb: '123456' });
  assert.deepEqual(art.officeArtColor(0x08000004), { scheme: 4 });
  assert.deepEqual(art.officeArtColor(0x100000f0), { system: 0xf0 });
});

test('shape types map to preset names where an equivalent outline exists', () => {
  assert.deepEqual([1, 2, 3, 13, 20, 32, 109, 202].map(art.officeArtPreset), ['rect', 'roundRect', 'ellipse', 'rightArrow', 'line', 'straightConnector1', 'flowChartProcess', 'rect']);
  assert.equal(art.officeArtPreset(0), undefined);
  assert.equal(art.officeArtPreset(136), undefined);
});
