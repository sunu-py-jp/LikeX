import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { xls, record, R, u16, u32, noCch, number, defaultFont, defaultFormats } from './xls-fixture.mjs';
import { artRecord, artContainer, shapeHeader, artProperties, groupBounds, blipEntry, pngBlip, blip, SHAPE } from '../../core/tests/office-art-fixture.mjs';

const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXls } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-drawings-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXls: importModel } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=', 'base64');
const P = { rotation: 0x0004, picture: 0x0104, fillColor: 0x0181, fillType: 0x0180, fillFlags: 0x01bf, lineColor: 0x01c0, lineWidth: 0x01cb, lineDash: 0x01ce, lineEnd: 0x01d1, lineFlags: 0x01ff, name: 0x0380, description: 0x0381, groupFlags: 0x03bf, cropTop: 0x0100 };
const FILLED = 0x00100010, UNFILLED = 0x00100000, LINED = 0x00080008, UNLINED = 0x00080000;
const name = value => [...value].flatMap(character => [character.charCodeAt(0) & 255, character.charCodeAt(0) >>> 8]).concat([0, 0]);
/** Cell anchor: flags, then column/offset and row/offset for the top-left and bottom-right corners. */
const anchor = (leftColumn, leftOffset, topRow, topOffset, rightColumn, rightOffset, bottomRow, bottomOffset) =>
  artRecord(0, 0, 0xf010, u16(0), u16(leftColumn), u16(leftOffset), u16(topRow), u16(topOffset), u16(rightColumn), u16(rightOffset), u16(bottomRow), u16(bottomOffset));
const shape = ({ id, type = 1, flags = SHAPE.hasAnchor | SHAPE.hasType, at = [1, 0, 1, 0, 3, 0, 4, 0], properties = [], text = false, data = true }) =>
  artContainer(0xf004, shapeHeader(id, type, flags), ...(properties.length ? [artProperties(properties)] : []), anchor(...at), ...(data ? [artRecord(0, 0, 0xf011)] : []), ...(text ? [artRecord(0, 0, 0xf00d)] : []));
const drawingRecord = shapes => record(R.MSODRAWING, artContainer(0xf002, artRecord(0, 1, 0xf008, u32(shapes.length + 1), u32(1024)),
  artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 0, 0), shapeHeader(1024, 0, SHAPE.group | SHAPE.patriarch)), ...shapes)));
/** Object record announcing a shape: its type and id. */
const object = (type, id) => record(R.OBJ, u16(0x15), u16(0x12), u16(type), u16(id), u16(0x6011), ...new Array(12).fill(0), u16(0), u16(0));
const textObject = (value, alignment = 0x0212) => [record(R.TXO, u16(alignment), u16(0), 0, 0, 0, 0, 0, 0, u16(value.length), u16(16), u16(0), u16(0)),
  record(R.CONTINUE, noCch(value, [...value].some(character => character.charCodeAt(0) > 255))), record(R.CONTINUE, new Array(16).fill(0))];
const pictures = (...items) => record(R.MSODRAWINGGROUP, artContainer(0xf000, artRecord(0, 0, 0xf006, new Array(16).fill(0)), artContainer(0xf001, ...items)));
const base = [defaultFont(), ...defaultFormats()];
const importSheet = (records, globals = base) => importModel(xls({ globals, sheets: [{ name: 'Sheet1', records }] }), measured);
const messages = result => result.warnings.map(warning => warning.message);

test('pictures are imported with their cell anchor, size and alternative text', async () => {
  const records = [number(0, 0, 1), drawingRecord([shape({ id: 1025, type: 75, at: [1, 512, 2, 128, 3, 0, 6, 0], properties: [[P.picture, 1, 'blip'], [P.description, name('会社ロゴ')], [P.name, name('Picture 1')]] })]), object(0x08, 1)];
  const result = await importSheet(records, [...base, pictures(blipEntry({ embedded: pngBlip(PNG) }))]);
  const [image] = result.workbook.sheets[0].drawings;
  assert.deepEqual([image.type, image.alt, image.anchor.row, image.anchor.column], ['image', '会社ロゴ', 2, 1]);
  // Default columns are 64 px and rows 17 px: from half of column B and half of row 3 to the start of column D and row 7.
  assert.ok(Math.abs(image.width - 96) < 0.6 && Math.abs(image.height - 59.5) < 0.6, `${image.width} x ${image.height}`);
  assert.equal(Object.values(result.workbook.resources.images).length, 1);
  assert.deepEqual(messages(result), []);
});

test('shapes, text boxes and lines keep their outline, colours and text', async () => {
  const shapes = [
    shape({ id: 1025, type: 2, properties: [[P.fillColor, 0x0033cc66], [P.fillFlags, FILLED], [P.lineColor, 0x0800000a], [P.lineWidth, 19050], [P.lineFlags, LINED]], text: true }),
    shape({ id: 1026, type: 202, at: [5, 0, 1, 0, 7, 0, 3, 0], properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: true }),
    shape({ id: 1027, type: 20, at: [1, 0, 6, 0, 3, 0, 8, 0], properties: [[P.lineColor, 0x000000ff], [P.lineEnd, 1]] }),
    shape({ id: 1028, type: 3, at: [1, 0, 9, 0, 2, 0, 11, 0], properties: [[P.fillColor, 0x0800000d], [P.fillFlags, FILLED], [P.lineFlags, UNLINED], [P.rotation, 30 << 16]] }),
  ];
  const records = [number(0, 0, 1), drawingRecord(shapes), object(0x02, 1), ...textObject('承認'), object(0x06, 2), ...textObject('メモ\n2行目', 0x0224), object(0x01, 3), object(0x03, 4)];
  const result = await importSheet(records);
  const [rounded, textBox, line, ellipse] = result.workbook.sheets[0].drawings;
  assert.deepEqual([rounded.type, rounded.shape, rounded.fill, rounded.stroke, rounded.strokeWidth, rounded.text], ['shape', 'roundedRectangle', '#66CC33', '#FF0000', 2, '承認']);
  assert.deepEqual([textBox.type, textBox.text, textBox.background, textBox.fontFamily], ['text', 'メモ\n2行目', 'transparent', 'Arial']);
  assert.deepEqual([line.type, line.shape, line.stroke, line.endArrow], ['shape', 'line', '#FF0000', 'triangle']);
  assert.deepEqual([ellipse.shape, ellipse.fill, ellipse.rotation, ellipse.strokeWidth], ['ellipse', '#FFFF00', 30, 0]);
  assert.deepEqual(messages(result), []);
});

test('charts, groups, form controls and unsupported outlines are reported with the XLSX wording', async () => {
  const shapes = [shape({ id: 1025, type: 201 }), artContainer(0xf003, shape({ id: 1026, type: 0, flags: SHAPE.group | SHAPE.hasAnchor }), shape({ id: 1027, flags: SHAPE.child | SHAPE.hasType })),
    shape({ id: 1028, type: 201 }), shape({ id: 1029, type: 0, properties: [[P.fillFlags, FILLED]] }), shape({ id: 1030, properties: [[P.groupFlags, 0x00020002]] }),
    shape({ id: 1031, properties: [[P.fillType, 7], [P.fillFlags, FILLED], [P.lineDash, 6]] })];
  const records = [number(0, 0, 1), drawingRecord(shapes), object(0x05, 1), object(0x00, 2), object(0x02, 3), object(0x0b, 4), object(0x02, 5), object(0x02, 6), object(0x02, 7)];
  const result = await importSheet(records);
  assert.deepEqual(result.workbook.sheets[0].drawings.map(drawing => drawing.shape), ['rectangle']);
  const expected = ['グラフ・グループなど未対応の描画オブジェクトを省略しました', '未対応の種類の図形を省略しました', '非表示の描画オブジェクトを省略しました', '図形のグラデーション・模様を単色へ変更しました', '図形の破線を実線へ変更しました'];
  for (const message of expected) assert.ok(messages(result).includes(message), message);
  assert.ok(messages(result).some(message => message.includes('フォームコントロール')));
  assert.equal(result.warnings.find(warning => warning.message.startsWith('グラフ・グループ')).count, 2);
});

test('comment boxes and filter buttons are not drawings', async () => {
  const shapes = [shape({ id: 1025, type: 202, text: true, properties: [[P.groupFlags, 0x00020002]] }), shape({ id: 1026, type: 201 }), shape({ id: 1027, properties: [[P.fillFlags, FILLED]] })];
  const filterName = record(R.NAME, u16(0x21), 0, 1, u16(11), u16(0), u16(1), 0, 0, 0, 0, 0, 13, 0x3b, ...u16(0), ...u16(0), ...u16(2), ...u16(0), ...u16(1));
  const links = [record(R.SUPBOOK, u16(1), u16(0x0401)), record(R.EXTERNSHEET, u16(1), u16(0), u16(0), u16(0))];
  const records = [number(0, 0, 1), number(1, 0, 2), record(R.AUTOFILTERINFO, u16(2)), drawingRecord(shapes), object(0x19, 1), ...textObject('note'), object(0x14, 2), object(0x02, 3),
    record(R.NOTE, u16(0), u16(0), u16(0), u16(1), [...u16(1), 0, 0x41], 0)];
  const result = await importSheet(records, [...base, ...links, filterName]);
  assert.deepEqual(result.workbook.sheets[0].drawings.map(drawing => drawing.type), ['shape']);
  assert.equal(result.workbook.sheets[0].comments.A1.text, 'note');
  assert.deepEqual(messages(result), []);
});

test('pictures without usable data, cropped pictures and other formats follow the XLSX rules', async () => {
  const shapes = [shape({ id: 1025, type: 75, properties: [[P.picture, 2, 'blip']] }), shape({ id: 1026, type: 75, at: [4, 0, 1, 0, 6, 0, 4, 0], properties: [[P.picture, 1, 'blip'], [P.cropTop, 3000]] }),
    shape({ id: 1027, type: 75, at: [7, 0, 1, 0, 8, 0, 4, 0], properties: [[P.picture, 9, 'blip']] })];
  const records = [number(0, 0, 1), drawingRecord(shapes), object(0x08, 1), object(0x08, 2), object(0x08, 3)];
  const result = await importSheet(records, [...base, pictures(blipEntry({ embedded: pngBlip(PNG) }), blipEntry({ embedded: blip(0xf01a, 0x3d4, new Array(40).fill(0)) }))]);
  assert.deepEqual(result.workbook.sheets[0].drawings.map(drawing => drawing.type), ['image']);
  assert.ok(messages(result).includes('画像のトリミング・タイル表示を省略しました'));
  assert.ok(messages(result).includes('外部リンクの画像を省略しました'));
  assert.ok(messages(result).some(message => message.includes('未対応または不正な画像を省略しました')));
});

test('drawing data split over several records and damaged data never stop the cells', async () => {
  const container = artContainer(0xf002, artRecord(0, 1, 0xf008, u32(2), u32(1024)), artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 0, 0), shapeHeader(1024, 0, SHAPE.group | SHAPE.patriarch)),
    shape({ id: 1025, properties: [[P.fillColor, 0x000000ff], [P.fillFlags, FILLED]] })));
  const split = await importSheet([number(0, 0, 1), record(R.MSODRAWING, container.subarray(0, 40)), record(R.CONTINUE, container.subarray(40, 70)), record(R.MSODRAWING, container.subarray(70)), object(0x02, 1)]);
  assert.deepEqual(split.workbook.sheets[0].drawings.map(drawing => drawing.fill), ['#FF0000']);
  const damaged = await importSheet([number(0, 0, 1), record(R.MSODRAWING, container.subarray(0, 50)), object(0x02, 1)]);
  assert.equal(damaged.workbook.sheets[0].cells.A1.value, '1');
  assert.equal(damaged.workbook.sheets[0].drawings, undefined);
});
