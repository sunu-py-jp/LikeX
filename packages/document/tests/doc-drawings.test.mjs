import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { doc, pictureData, S } from './doc-fixture.mjs';
import { artContainer, artProperties, artRecord, blip, groupBounds, jpegBlip, pngBlip, shapeHeader, utf16, SHAPE } from '../../core/tests/office-art-fixture.mjs';

const output = await build({ stdin: { contents: 'export * from "./src/io";', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'doc-drawings-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importDocumentDoc } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
// Real, decodable images: the document model validates embedded pictures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=', 'base64');
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 20, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
const P = { picture: 0x0104, cropTop: 0x0100, fillColor: 0x0181, fillFlags: 0x01bf, lineColor: 0x01c0, lineWidth: 0x01cb, lineFlags: 0x01ff, name: 0x0380, description: 0x0381 };
const FLOATING_PICTURE = '浮動配置の画像は本文中の画像として読み込みました';
const FLOATING_SHAPE = '浮動配置の図形は本文中の図形として読み込みました（重なり・回り込み・ページ上の位置は保持しません）';
const OMITTED = '旧形式の図形・埋め込みオブジェクトを省略しました';

/** A drawn object is anchored at a 0x08 character marked as special; the anchor table names its shape and box. */
const anchored = (before, after = '') => ({ runs: [{ text: before }, { text: '\u0008', sprms: S.special() }, ...(after ? [{ text: after }] : [])] });
const shape = (spid, type, properties = [], flags) => artContainer(0xf004, shapeHeader(spid, type, flags), ...(properties.length ? [artProperties(properties)] : []));
const picture = (spid, index, properties = []) => shape(spid, 75, [[P.picture, index, 'blip'], ...properties]);
const kinds = result => result.document.content.content.map(node => node.type === 'paragraph' ? (node.content ?? []).map(item => item.text).join('') : node.type);
const nodes = (result, type) => result.document.content.content.filter(node => node.type === type);

test('a floating picture is imported where it is anchored, as the DOCX reader imports an anchored picture', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [anchored('before', 'after'), { text: 'next' }], floating: {
    anchors: [{ cp: 6, spid: 1025, bounds: [100, 200, 2980, 1640] }], blips: [pngBlip(PNG)],
    drawings: [{ shapes: [picture(1025, 1, [[P.name, utf16('Screen')], [P.description, utf16('Order entry screen')]])] }] } }));
  assert.deepEqual(kinds(result), ['before', 'image', 'after', 'next']);
  const [image] = nodes(result, 'image');
  assert.deepEqual([image.attrs.width, image.attrs.height, image.attrs.alt, image.attrs.src.slice(0, 22)], [192, 96, 'Order entry screen', 'data:image/png;base64,']);
  assert.equal(image.attrs.src, `data:image/png;base64,${PNG.toString('base64')}`);
  assert.deepEqual(result.warnings, [FLOATING_PICTURE]);
});

test('pictures kept inside their store entry, several anchors of one picture, and crops are handled', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [anchored('a'), anchored('b'), anchored('c')], floating: { embedded: true,
    anchors: [{ cp: 1, spid: 1025, bounds: [0, 0, 1440, 1440] }, { cp: 4, spid: 1026, bounds: [0, 0, 720, 720] }, { cp: 7, spid: 1027, bounds: [0, 0, 1440, 720] }], blips: [jpegBlip(JPEG), pngBlip(PNG)],
    drawings: [{ shapes: [picture(1025, 1), picture(1026, 1), picture(1027, 2, [[P.cropTop, 6553]])] }] } }));
  assert.deepEqual(kinds(result), ['a', 'image', 'b', 'image', 'c', 'image']);
  assert.deepEqual(nodes(result, 'image').map(node => [node.attrs.width, node.attrs.height, node.attrs.src.slice(5, 15)]), [[96, 96, 'image/jpeg'], [48, 48, 'image/jpeg'], [96, 48, 'image/png;']]);
  assert.deepEqual(result.warnings.sort(), [FLOATING_PICTURE, '画像の回転・反転・切り抜きを省略しました'].sort());
});

test('text boxes and outline shapes become shapes with their text, fill and line', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [anchored('box'), anchored('plain'), anchored('round')], floating: {
    anchors: [{ cp: 3, spid: 1025, bounds: [0, 0, 3000, 1500] }, { cp: 10, spid: 1026, bounds: [0, 0, 1500, 750] }, { cp: 17, spid: 1027, bounds: [0, 0, 1500, 1500] }],
    drawings: [{ shapes: [
      shape(1025, 202, [[P.fillColor, 0x00ccffff], [P.lineColor, 0x00804000], [P.lineWidth, 19050]]),
      shape(1026, 1, [[P.fillFlags, 0x00100000], [P.lineFlags, 0x00080000]]),
      shape(1027, 3),
    ] }],
    textboxes: [{ spid: 1025, text: 'Reference\rOrder number\tSupplier \u0013 PAGE \u00147\u0015' }, { spid: 1027, text: '' }] } }));
  assert.deepEqual(kinds(result), ['box', 'shape', 'plain', 'shape', 'round', 'shape']);
  const [box, plain, round] = nodes(result, 'shape').map(node => node.attrs);
  assert.deepEqual([box.preset, box.text, box.width, box.height, box.fill, box.stroke, box.strokeWidth], ['rect', 'Reference\nOrder number\tSupplier 7', 200, 100, '#ffffcc', '#004080', 2]);
  assert.deepEqual([plain.preset, plain.text, plain.fill, plain.stroke, plain.width, plain.height], ['rect', '', null, null, 100, 50]);
  // Unstated colours are those of the format: a white fill and a thin black line, not those of a new shape.
  assert.deepEqual([round.preset, round.text, round.fill, round.stroke, round.strokeWidth], ['ellipse', '', '#ffffff', '#000000', 1]);
  // The model centres the text of a shape; the reader says so, as it does for DOCX.
  assert.deepEqual(result.warnings.sort(), [FLOATING_SHAPE, '図形内の段落配置は中央揃えに変換しました', '図形内の文字配置・余白は標準の中央配置に変換しました'].sort());
});

test('drawn objects without a counterpart are omitted with the wording of the DOCX reader', async () => {
  const group = artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 100, 100), shapeHeader(1030, 0, SHAPE.group)), shape(1031, 1, [], SHAPE.child | SHAPE.hasType));
  const result = await importDocumentDoc(doc({ paragraphs: [anchored('line'), anchored('group'), anchored('metafile'), anchored('free'), anchored('header only'), anchored('unlisted')], floating: {
    anchors: [{ cp: 4, spid: 1025, bounds: [0, 0, 1000, 10] }, { cp: 11, spid: 1030, bounds: [0, 0, 1000, 1000] }, { cp: 21, spid: 1026, bounds: [0, 0, 1000, 1000] },
      { cp: 27, spid: 1027, bounds: [0, 0, 1000, 1000] }, { cp: 40, spid: 2049, bounds: [0, 0, 1000, 1000] }],
    blips: [blip(0xf01a, 0x3d4, [1, 2, 3, 4])],
    drawings: [{ shapes: [shape(1025, 20), group, picture(1026, 1), shape(1027, 0)] }, { header: true, shapes: [shape(2049, 1)] }] } }));
  assert.deepEqual(kinds(result), ['line', 'group', 'metafile', 'free', 'header only', 'unlisted']);
  assert.deepEqual(result.warnings.sort(), ['未対応の図形プリセット・自由図形を省略しました (line)', 'グループ化された図形は未対応のため省略しました', 'PNG・JPEG以外の画像を省略しました',
    '未対応の図形プリセット・自由図形を省略しました', '未対応の図形・グラフ・SmartArtなどの描画要素を省略しました', OMITTED].sort());
});

test('bitmaps, as Office 97 keeps a pasted screen shot, are converted to PNG whether inline or floating', async () => {
  // Two by two pixels, bottom row first, blue-green-red, rows padded to four bytes.
  const header = [40, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 24, 0, ...new Array(24).fill(0)];
  const bitmap = Uint8Array.from([...header, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]), stored = blip(0xf01f, 0x7a8, bitmap);
  const size = src => { const png = Buffer.from(src.slice('data:image/png;base64,'.length), 'base64'); return [png.subarray(1, 4).toString(), png.readUInt32BE(16), png.readUInt32BE(20)]; };
  const floating = await importDocumentDoc(doc({ paragraphs: [anchored('shot')], floating: { anchors: [{ cp: 4, spid: 1025, bounds: [0, 0, 1440, 720] }], blips: [stored], drawings: [{ shapes: [picture(1025, 1)] }] } }));
  const [above] = nodes(floating, 'image');
  assert.deepEqual([size(above.attrs.src), above.attrs.width, above.attrs.height, floating.warnings], [['PNG', 2, 2], 96, 48, [FLOATING_PICTURE]]);
  const inline = await importDocumentDoc(doc({ data: pictureData([artContainer(0xf004, shapeHeader(1, 75)), stored]), paragraphs: [{ runs: [{ text: '\u0001', sprms: [...S.special(), ...S.pictureOffset(0)] }] }] }));
  assert.deepEqual([size(nodes(inline, 'image')[0].attrs.src), inline.warnings], [['PNG', 2, 2], []]);
  // A bitmap that cannot be read (here: run-length compressed) is left out, named as the reader names unreadable image data.
  const compressed = Uint8Array.from(bitmap); compressed[16] = 1;
  const unreadable = await importDocumentDoc(doc({ paragraphs: [anchored('shot')], floating: { anchors: [{ cp: 4, spid: 1025, bounds: [0, 0, 1440, 720] }], blips: [blip(0xf01f, 0x7a8, compressed)], drawings: [{ shapes: [picture(1025, 1)] }] } }));
  assert.deepEqual([kinds(unreadable), unreadable.warnings.sort()], [['shot'], ['画像データの形式を確認できない画像を省略しました', '未対応の図形・グラフ・SmartArtなどの描画要素を省略しました'].sort()]);
});

test('damaged drawing tables lose the drawn objects, not the text', async () => {
  const anchors = [{ cp: 4, spid: 1025, bounds: [0, 0, 1000, 1000] }], drawings = [{ shapes: [picture(1025, 1)] }];
  for (const floating of [
    { anchors, blips: [pngBlip(PNG)], drawings, drawingData: [1, 2, 3] },
    { anchors, blips: [pngBlip(PNG)], drawings, anchorTable: [4, 0, 0] },
    { anchors: [{ cp: 4, spid: 1025, bounds: [0, 0, 0, 0] }], blips: [pngBlip(PNG)], drawings },
    { anchors, blips: [artRecord(0, 0x6e0, 0xf01e, [1, 2, 3])], drawings },
    { anchors, drawings },
  ]) {
    const result = await importDocumentDoc(doc({ paragraphs: [anchored('text', 'more')], floating }));
    assert.deepEqual(kinds(result), ['textmore']);
    assert.deepEqual(result.warnings, [OMITTED]);
  }
});

// A3 landscape with the text in a column on the right, as manuals keep a screen beside its explanation.
const SIDE_BY_SIDE = [{ sprms: [...S.pageWidth(23811), ...S.pageHeight(16838), ...S.marginLeft(15000), ...S.marginRight(850)] }];
/** Anchor flags: the origins of the box (1 margin, page or column; 2 margin, page or paragraph), how text passes it, and whether it lies behind the text. */
const flags = ({ horizontal = 0, vertical = 0, wrap = 0, behind = false }) => horizontal << 1 | vertical << 3 | wrap << 5 | (behind ? 0x4000 : 0);
const mm = twips => twips * 25.4 / 1440;
const placed = (actual, expected) => { for (const axis of ['horizontal', 'vertical']) { assert.equal(actual[axis].from, expected[axis].from); assert.ok(Math.abs(actual[axis].offset - expected[axis].offset) < .02, `${actual[axis].offset} ≈ ${expected[axis].offset}`); } };

test('objects that stand beside the text keep their place on the page', async () => {
  const result = await importDocumentDoc(doc({ sections: SIDE_BY_SIDE, paragraphs: [anchored('', 'Title'), anchored('Body'), anchored('More'), { text: 'End' }], floating: {
    anchors: [
      // Measured from the column, to its left: the usual anchor of a picture dragged into the margin.
      { cp: 0, spid: 1025, bounds: [-14000, 300, -500, 7000], flags: flags({ horizontal: 2, vertical: 2 }) },
      { cp: 11, spid: 1026, bounds: [600, 9000, 3600, 11000], flags: flags({ horizontal: 1, vertical: 1, wrap: 1 }) },
      // The shape states its own origins and an alignment, which replace those of the anchor.
      { cp: 17, spid: 1027, bounds: [9999, 9999, 12999, 10999], flags: flags({ wrap: 4 }) },
    ], blips: [pngBlip(PNG)],
    drawings: [{ shapes: [picture(1025, 1, [[P.description, utf16('Order entry screen')]]), shape(1026, 202), shape(1027, 1, [[0x038f, 1], [0x0390, 1], [0x0391, 3], [0x0392, 0]])] }],
    textboxes: [{ spid: 1026, text: 'Lookup\rItem code' }] } }));
  // Each object stands before its paragraph, which it does not divide; nothing is reported as moved into the text.
  assert.deepEqual(kinds(result), ['image', 'Title', 'shape', 'Body', 'shape', 'More', 'End']);
  assert.deepEqual(result.warnings.filter(warning => warning.includes('浮動配置')), []);
  const [image] = nodes(result, 'image'), [box, rectangle] = nodes(result, 'shape');
  placed(image.attrs.position, { horizontal: { from: 'margin', offset: mm(-14000) }, vertical: { from: 'paragraph', offset: mm(300) } });
  assert.deepEqual([image.attrs.width, image.attrs.height, image.attrs.alt], [900, 6700 / 15, 'Order entry screen']);
  placed(box.attrs.position, { horizontal: { from: 'page', offset: mm(600) }, vertical: { from: 'page', offset: mm(9000) } });
  assert.equal(box.attrs.text, 'Lookup\nItem code');
  // Left of the page, bottom of the text area: 16838 − 1440 − 1440 twips of text, less the height of the shape.
  placed(rectangle.attrs.position, { horizontal: { from: 'page', offset: 0 }, vertical: { from: 'margin', offset: mm(16838 - 2880 - 1000) } });
});

test('over the text an object keeps its place only in front of it', async () => {
  const over = (wrap, behind) => importDocumentDoc(doc({ paragraphs: [anchored('Text', 'more')], floating: {
    anchors: [{ cp: 4, spid: 1025, bounds: [720, 1440, 2160, 2160], flags: flags({ horizontal: 2, vertical: 2, wrap, behind }) }], blips: [pngBlip(PNG)], drawings: [{ shapes: [picture(1025, 1)] }] } }));
  const front = await over(3, false);
  assert.deepEqual(kinds(front), ['image', 'Textmore']); assert.deepEqual(front.warnings, []);
  placed(nodes(front, 'image')[0].attrs.position, { horizontal: { from: 'margin', offset: mm(720) }, vertical: { from: 'paragraph', offset: mm(1440) } });
  // Behind the text, or with the text wrapped around it, it is a block of the text as before.
  for (const result of [await over(3, true), await over(0, false), await over(2, false), await over(4, false), await over(5, false), await over(1, false)]) {
    assert.deepEqual(kinds(result), ['Text', 'image', 'more']); assert.deepEqual(result.warnings, [FLOATING_PICTURE]);
    assert.equal('position' in nodes(result, 'image')[0].attrs, false);
  }
});
