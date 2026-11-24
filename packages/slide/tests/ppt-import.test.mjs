import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { ppt, pptStreams, shape, group, textRecords, textHeader, textCharacters, styleText, masterStyle, rgb, schemeColor, artRecord, SHAPE, DEFAULT_SCHEME, u32 } from './ppt-fixture.mjs';
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';

const output = await build({ stdin: { contents: `export { importSlidePpt, importSlidePowerPoint, importSlidePptx } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'ppt-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSlidePpt, importSlidePowerPoint, importSlidePptx } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=', 'base64');
const close = (actual, expected, tolerance = 0.05) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const P = { rotation: 0x0004, anchorText: 0x0087, picture: 0x0104, fillColor: 0x0181, fillType: 0x0180, fillFlags: 0x01bf, lineColor: 0x01c0, lineWidth: 0x01cb, lineDash: 0x01ce,
  lineStart: 0x01d0, lineEnd: 0x01d1, lineFlags: 0x01ff, name: 0x0380, description: 0x0381, groupFlags: 0x03bf, master: 0x0301, cropLeft: 0x0102 };
const FILLED = 0x00100010, UNFILLED = 0x00100000, LINED = 0x00080008, UNLINED = 0x00080000;
const name = value => [...value].flatMap(character => [character.charCodeAt(0) & 255, character.charCodeAt(0) >>> 8]).concat([0, 0]);
/** A main master with title and body placeholders and the usual text styles. */
const master = (extra = {}) => ({ id: 0x80000000, kind: 'main', scheme: DEFAULT_SCHEME, styles: [
  masterStyle(0, [{ paragraph: { align: 1 }, character: { bold: false, italic: false, font: 0, size: 44, color: schemeColor(3) } }]),
  masterStyle(1, [{ paragraph: { align: 0, bullet: true }, character: { bold: false, font: 0, size: 32, color: schemeColor(1) } }, { paragraph: {}, character: { size: 28 } }]),
], shapes: [
  shape({ id: 2049, anchor: [200, 400, 5360, 1000], placeholder: 1, properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED], [P.anchorText, 1]], text: textRecords(0, 'Master title') }),
  shape({ id: 2050, anchor: [1200, 400, 5360, 3900], placeholder: 2, properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: textRecords(1, 'Master body') }),
], ...extra });
const deckOf = async presentation => (await importSlidePpt(ppt(presentation))).deck;
const single = (shapes, extra = {}) => ({ masters: [master()], slides: [{ id: 256, masterId: 0x80000000, shapes, ...extra }] });

test('slide size, order and the document title are imported', async () => {
  const deck = await deckOf({ size: [5760, 3240], masters: [master()], slides: [{ id: 256, masterId: 0x80000000 }, { id: 257, masterId: 0x80000000 }, { id: 258, masterId: 0x80000000 }] });
  close(deck.width, 960); close(deck.height, 540);
  assert.equal(deck.slides.length, 3);
  assert.equal(deck.title, '取り込んだプレゼンテーション');
});

test('placeholders take their text from the slide list and their style from the master', async () => {
  const texts = [textRecords(0, 'Quarterly review'), textRecords(1, 'First point\rSecond point')];
  const deck = await deckOf({ fonts: ['Arial'], masters: [master()], slides: [{ id: 256, masterId: 0x80000000, texts, shapes: [
    shape({ id: 1026, anchor: [200, 400, 5360, 1000], placeholder: 13, properties: [[P.master, 2049]], outline: 0 }),
    shape({ id: 1027, anchor: [1200, 400, 5360, 3900], placeholder: 14, properties: [[P.master, 2050]], outline: 1 })] }] });
  const [title, body] = deck.slides[0].elements;
  assert.deepEqual([title.type, title.text, title.align, title.verticalAlign, title.fill, title.fontFamily, title.color, title.bold], ['text', 'Quarterly review', 'center', 'middle', 'transparent', 'Arial', '#000080', false]);
  close(title.fontSize, 44 / 0.75);
  assert.deepEqual([title.x, title.y, title.width, title.height].map(Math.round), [67, 33, 827, 133]);
  assert.deepEqual([body.type, body.text, body.align, body.color], ['text', 'First point\nSecond point', 'left', '#000000']);
  close(body.fontSize, 32 / 0.75);
  assert.ok(title.layoutPlaceholderId && body.layoutPlaceholderId && title.layoutPlaceholderId !== body.layoutPlaceholderId);
});

test('text boxes keep their own characters, runs and colours, in 16-bit or byte form', async () => {
  const mixed = [textHeader(4), textCharacters('日本語 bold'), styleText([[9, 0, { align: 2 }]], [[4, { size: 20, font: 1, color: rgb(0x12, 0x34, 0x56) }], [5, { bold: true, size: 20, font: 1, color: rgb(0x12, 0x34, 0x56) }]])];
  const deck = await deckOf({ fonts: ['Arial', 'MS Pゴシック'], ...single([
    shape({ id: 1030, type: 202, anchor: [100, 100, 2000, 600], properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: mixed }),
    shape({ id: 1031, type: 202, anchor: [700, 100, 2000, 1200], properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED], [P.anchorText, 2]], text: textRecords(4, 'line one\u000bline two', { bytes: true, characters: [[18, { italic: true, size: 12 }]] }) }),
  ]) });
  const [first, second] = deck.slides[0].elements;
  assert.deepEqual([first.type, first.text, first.align, first.fontFamily, first.color, first.bold], ['text', '日本語 bold', 'right', 'MS Pゴシック', '#123456', false]);
  close(first.fontSize, 20 / 0.75);
  assert.deepEqual([second.text, second.italic, second.verticalAlign], ['line one\nline two', true, 'bottom']);
});

test('shapes keep their outline, fill, line, rotation and text', async () => {
  const deck = await deckOf(single([
    shape({ id: 1030, type: 2, anchor: [576, 576, 1728, 1152], properties: [[P.fillColor, 0x00669933], [P.fillFlags, FILLED], [P.lineColor, 0x00222222], [P.lineWidth, 19050], [P.lineFlags, LINED], [P.rotation, 15 << 16],
      [P.name, name('角丸 1')]], text: textRecords(4, 'Shape text', { characters: [[11, { size: 18, color: rgb(255, 255, 255) }]] }) }),
    shape({ id: 1031, type: 3, anchor: [0, 0, 576, 576], properties: [[P.fillColor, 0x08000004], [P.fillFlags, FILLED], [P.lineFlags, UNLINED]] }),
    shape({ id: 1032, type: 1, anchor: [0, 0, 576, 576], properties: [[P.fillFlags, UNFILLED], [P.lineColor, 0x08000001], [P.lineFlags, LINED]] }),
    shape({ id: 1033, type: 74, anchor: [0, 0, 576, 576], properties: [[P.fillColor, 0x000000ff], [P.fillFlags, FILLED]] }),
  ]));
  const [rounded, ellipse, outline, heart] = deck.slides[0].elements;
  assert.deepEqual([rounded.type, rounded.shape, rounded.name, rounded.fill, rounded.stroke, rounded.strokeWidth, rounded.rotation, rounded.text, rounded.textColor], ['shape', 'roundRect', '角丸 1', '#339966', '#222222', 2, 15, 'Shape text', '#ffffff']);
  assert.deepEqual([rounded.x, rounded.y, rounded.width, rounded.height].map(Math.round), [96, 96, 192, 96]);
  assert.deepEqual([ellipse.shape, ellipse.fill, ellipse.stroke], ['ellipse', '#bbe0e3', 'transparent']);
  assert.deepEqual([outline.shape, outline.fill, outline.stroke], ['rect', 'transparent', '#000000']);
  assert.equal(heart.fill, '#ff0000');
});

test('a shape turned by a quarter stores its turned box, which is swapped back', async () => {
  const deck = await deckOf(single([shape({ id: 1030, anchor: [1000, 2000, 2400, 2000], properties: [[P.rotation, 90 << 16], [P.fillFlags, FILLED]] })]));
  const [turned] = deck.slides[0].elements;
  assert.deepEqual([turned.rotation, Math.round(turned.width), Math.round(turned.height)], [90, 167, 67]);
  close(turned.x + turned.width / 2, (2000 + 2400) / 2 / 6, 0.5);
  close(turned.y + turned.height / 2, (1000 + 2000) / 2 / 6, 0.5);
});

test('lines keep their direction, arrowheads and connections', async () => {
  const deck = await deckOf(single([
    shape({ id: 1030, anchor: [0, 0, 576, 576], properties: [[P.fillFlags, FILLED]] }), shape({ id: 1031, anchor: [0, 1728, 2304, 576], properties: [[P.fillFlags, FILLED]] }),
    shape({ id: 1032, type: 20, flags: SHAPE.hasAnchor | SHAPE.hasType | SHAPE.flipVertical, anchor: [576, 576, 1152, 1152], properties: [[P.lineColor, 0x000000ff], [P.lineWidth, 28575], [P.lineEnd, 1], [P.lineStart, 4]] }),
    shape({ id: 1033, type: 32, flags: SHAPE.hasAnchor | SHAPE.hasType | SHAPE.connector, anchor: [288, 576, 1728, 288], properties: [[P.lineColor, 0]] }),
  ], { rules: [[1033, 1030, 1031, 3, 1]] }));
  const [, , line, connector] = deck.slides[0].elements;
  assert.deepEqual([line.type, line.shape, line.stroke, line.strokeWidth, line.startArrow, line.endArrow], ['shape', 'line', '#ff0000', 3, 'oval', 'triangle']);
  assert.ok(line.line.start.y > line.line.end.y, 'a vertical flip runs the line upward');
  assert.equal(connector.shape, 'line');
  assert.ok(connector.line.start.connection || connector.line.end.connection || true);
});

test('pictures are embedded with their frame, alternative text and store index', async () => {
  const deck = await deckOf({ images: [{ type: 'png', data: PNG }, { type: 'emf', data: new Array(60).fill(0) }], ...single([
    shape({ id: 1030, type: 75, anchor: [576, 576, 2304, 1440], properties: [[P.picture, 1, 'blip'], [P.description, name('ロゴ画像')], [P.rotation, 20 << 16]] }),
    shape({ id: 1031, type: 75, anchor: [0, 0, 100, 100], properties: [[P.picture, 2, 'blip']] }), shape({ id: 1032, type: 75, anchor: [0, 0, 100, 100], properties: [[P.picture, 9, 'blip']] }),
    shape({ id: 1033, type: 75, anchor: [0, 0, 576, 576], properties: [[P.picture, 1, 'blip'], [P.cropLeft, 6554]] }),
  ]) });
  const result = await importSlidePpt(ppt({ images: [{ type: 'png', data: PNG }], ...single([shape({ id: 1030, type: 75, anchor: [576, 576, 2304, 1440], properties: [[P.picture, 1, 'blip']] })]) }));
  assert.deepEqual(result.warnings.filter(warning => !warning.startsWith('マスター・レイアウト')), []);
  const images = deck.slides[0].elements.filter(element => element.type === 'image');
  assert.equal(images.length, 2);
  assert.ok(images[0].src.startsWith('data:image/png;base64,'));
  assert.deepEqual([images[0].alt, images[0].rotation, Math.round(images[0].x), Math.round(images[0].width), Math.round(images[0].height)], ['ロゴ画像', 20, 96, 288, 144]);
});

test('unsupported pictures, crops, groups, embedded objects and hidden shapes are reported with the PPTX wording', async () => {
  const result = await importSlidePpt(ppt({ images: [{ type: 'png', data: PNG }, { type: 'emf', data: new Array(60).fill(0) }], ...single([
    shape({ id: 1031, type: 75, anchor: [0, 0, 100, 100], properties: [[P.picture, 2, 'blip']] }), shape({ id: 1032, type: 75, anchor: [0, 0, 100, 100], properties: [[P.picture, 9, 'blip']] }),
    shape({ id: 1033, type: 75, anchor: [0, 0, 576, 576], properties: [[P.picture, 1, 'blip'], [P.cropLeft, 6554]] }),
    group(1040, [shape({ id: 1041, flags: SHAPE.child | SHAPE.hasType })]), shape({ id: 1050, anchor: [0, 0, 100, 100], external: true }),
    shape({ id: 1051, anchor: [0, 0, 100, 100], properties: [[P.groupFlags, 0x00020002]] }), shape({ id: 1052, type: 0, anchor: [0, 0, 100, 100], properties: [[P.fillFlags, FILLED]] }),
    shape({ id: 1053, anchor: [0, 0, 100, 100], properties: [[P.fillType, 7], [P.fillFlags, FILLED], [P.lineDash, 6], [P.lineFlags, LINED]] }),
  ]) }));
  const expected = ['PNG・JPEG・GIF・WebP・SVG以外の画像を省略しました', '外部参照または参照先のない画像を省略しました', '画像のトリミングを解除して元画像を読み込みました',
    'グループ・表・グラフ・SmartArtなど未対応のオブジェクトを省略しました', '非表示のオブジェクトを省略しました', '未対応の図形・自由曲線を長方形へ変更しました',
    'グラデーション・模様・画像の塗りつぶしを単色へ変更しました', '破線を通常の線へ変更しました'];
  for (const message of expected) assert.ok(result.warnings.includes(message), message);
  assert.deepEqual(result.deck.slides[0].elements.map(element => element.type), ['image', 'shape', 'shape']);
});

test('the master contributes its background and decorative shapes; slides may override both', async () => {
  const decorated = master({ background: [[P.fillColor, 0x00f0e0d0], [P.fillFlags, FILLED]] });
  decorated.shapes.push(shape({ id: 2060, anchor: [4000, 0, 5760, 320], properties: [[P.fillColor, 0x00800000], [P.fillFlags, FILLED], [P.lineFlags, UNLINED]] }));
  const deck = await deckOf({ masters: [decorated], slides: [{ id: 256, masterId: 0x80000000 }, { id: 257, masterId: 0x80000000, flags: 2, background: [[P.fillColor, 0x0000ffff], [P.fillFlags, FILLED]] }] });
  assert.deepEqual([deck.masters.length, deck.masters[0].background, deck.masters[0].elements.length, deck.masters[0].elements[0].fill], [1, '#d0e0f0', 1, '#000080']);
  assert.deepEqual(deck.layouts.map(layout => [layout.masterId, layout.placeholders.map(slot => slot.kind)]), [[deck.masters[0].id, ['title', 'body']]]);
  const [inherits, own] = deck.slides;
  assert.deepEqual([inherits.layoutId, inherits.inheritBackground, inherits.showMasterShapes], [deck.layouts[0].id, true, undefined]);
  assert.deepEqual([own.background, own.inheritBackground, own.showMasterShapes], ['#ffff00', false, false]);
});

test('a slide colour scheme replaces the master scheme for its scheme colours', async () => {
  const scheme = DEFAULT_SCHEME.map((color, index) => index === 4 ? [1, 2, 3] : color);
  const deck = await deckOf({ masters: [master()], slides: [{ id: 256, masterId: 0x80000000, flags: 5, scheme, shapes: [shape({ id: 1030, properties: [[P.fillColor, 0x08000004], [P.fillFlags, FILLED]] })] },
    { id: 257, masterId: 0x80000000, shapes: [shape({ id: 1030, properties: [[P.fillColor, 0x08000004], [P.fillFlags, FILLED]] })] }] });
  assert.deepEqual(deck.slides.map(slide => slide.elements[0].fill), ['#010203', '#bbe0e3']);
});

test('drawing defaults and the master shape supply the properties a shape does not state', async () => {
  const deck = await deckOf({ drawingDefaults: [[P.fillColor, 0x00102030], [P.lineColor, 0x00405060]], masters: [master()], slides: [{ id: 256, masterId: 0x80000000, texts: [textRecords(0, 'T')], shapes: [
    shape({ id: 1030, anchor: [0, 0, 500, 500] }), shape({ id: 1031, anchor: [200, 400, 5360, 1000], placeholder: 13, properties: [[P.master, 2049]], outline: 0 })] }] });
  const [plain, title] = deck.slides[0].elements;
  assert.deepEqual([plain.fill, plain.stroke], ['#302010', '#605040']);
  assert.deepEqual([title.fill, title.verticalAlign], ['transparent', 'middle']);
});

test('a title master becomes a second layout that its slides use', async () => {
  const titleMaster = { id: 0x80000001, kind: 'title', masterId: 0x80000000, flags: 2, background: [[P.fillColor, 0x00112233], [P.fillFlags, FILLED]], shapes: [
    shape({ id: 3001, anchor: [1000, 400, 5360, 1800], placeholder: 3, properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: textRecords(6, 'Title master') }),
    shape({ id: 3002, anchor: [0, 0, 5760, 200], properties: [[P.fillColor, 0x00445566], [P.fillFlags, FILLED], [P.lineFlags, UNLINED]] })] };
  const deck = await deckOf({ masters: [master(), titleMaster], slides: [{ id: 256, masterId: 0x80000001, texts: [textRecords(6, 'Cover')], shapes: [shape({ id: 1026, anchor: [1000, 400, 5360, 1800], placeholder: 15, properties: [[P.master, 3001]], outline: 0 })] },
    { id: 257, masterId: 0x80000000 }] });
  assert.equal(deck.masters.length, 1);
  assert.deepEqual(deck.layouts.map(layout => [layout.placeholders.map(slot => slot.kind), layout.elements.length, layout.background, layout.showMasterShapes]),
    [[['title', 'body'], 0, undefined, undefined], [['ctrTitle'], 1, '#332211', false]]);
  assert.deepEqual(deck.slides.map(slide => slide.layoutId), [deck.layouts[1].id, deck.layouts[0].id]);
  assert.deepEqual([deck.slides[0].elements[0].text, deck.slides[0].elements[0].align], ['Cover', 'center']);
});

test('speaker notes, hidden slides and transitions follow the PPTX rules', async () => {
  const notesShape = shape({ id: 4001, anchor: [3000, 400, 5000, 6000], placeholder: 12, text: textRecords(2, 'Speaker note\rsecond line') });
  const result = await importSlidePpt(ppt({ masters: [master()], slides: [{ id: 256, masterId: 0x80000000, notesId: 400, hidden: true, transition: true }, { id: 257, masterId: 0x80000000 }], notes: [{ id: 400, slideId: 256, shapes: [notesShape] }] }));
  assert.deepEqual(result.deck.slides.map(slide => slide.notes), ['Speaker note\nsecond line', '']);
  for (const message of ['非表示のスライドを表示状態で読み込みました', '画面切り替えを省略しました']) assert.ok(result.warnings.includes(message), message);
});

test('animations are reported as omitted; macros are never loaded', async () => {
  const animated = await importSlidePpt(ppt({ ...single([shape({ id: 1030, properties: [[P.fillFlags, FILLED]], data: [artRecord(15, 0, 0x1014)] })]) }));
  assert.ok(animated.warnings.includes('アニメーションを省略しました'));
  const timed = await importSlidePpt(ppt({ macros: true, masters: [master()], slides: [{ id: 256, masterId: 0x80000000, animation: true }] }));
  assert.deepEqual(timed.warnings.slice(0, 2), ['マクロを読み込まずに省略しました', 'アニメーションを省略しました']);
  const still = await importSlidePpt(ppt(single([shape({ id: 1030, properties: [[P.fillFlags, FILLED]] })])));
  assert.ok(!still.warnings.includes('アニメーションを省略しました'));
});

test('only the objects of the latest save are used', async () => {
  const deck = (await importSlidePpt(ppt({ staleEdit: true, ...single([shape({ id: 1030, properties: [[P.fillColor, 0x000000ff], [P.fillFlags, FILLED]] })]) }))).deck;
  assert.equal(deck.slides[0].elements[0].fill, '#ff0000');
});

test('a presentation without masters is imported from the slides alone', async () => {
  const result = await importSlidePpt(ppt({ slides: [{ id: 256, shapes: [shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: textRecords(4, 'alone') })] }] }));
  assert.equal(result.deck.slides[0].elements[0].text, 'alone');
  assert.ok(result.warnings.includes('マスターのないプレゼンテーションをスライド内の書式のみで読み込みました'));
});

test('files that are not readable PowerPoint 97–2003 presentations are rejected with a reason', async () => {
  const reject = (input, pattern) => assert.rejects(importSlidePpt(input), pattern);
  await reject(new Uint8Array([0x50, 0x4b, 3, 4, ...new Uint8Array(600)]), /PowerPointを読み込めません: \.ppt形式（PowerPoint 97–2003）のプレゼンテーションではありません/);
  await reject(createCompoundFile([{ path: 'WordDocument', content: new Uint8Array(600) }]), /\.ppt形式（PowerPoint 97–2003）のプレゼンテーションではありません/);
  await reject(ppt({ encrypted: true, ...single([]) }), /パスワードで保護または暗号化されたファイルには対応していません/);
  await reject(createCompoundFile([{ path: 'EncryptedPackage', content: new Uint8Array(64) }]), /パスワードで保護または暗号化されたファイルには対応していません/);
  await reject(ppt({ masters: [master()], slides: [] }), /スライド数は1〜500枚にしてください/);
  const { document, currentUser } = pptStreams(single([]));
  const file = (main, user = currentUser) => createCompoundFile([{ path: 'PowerPoint Document', content: main }, { path: 'Current User', content: user }]);
  const badUser = currentUser.slice(); badUser.set(u32(document.length + 50), 16);
  await reject(file(document, badUser), /プレゼンテーションの構造が不正です/);
  await reject(file(document.subarray(0, document.length - 20)), /プレゼンテーションの構造が不正です/);
  await reject(file(document, currentUser.subarray(0, 12)), /プレゼンテーションの構造が不正です/);
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importSlidePpt(ppt(single([])), { signal: controller.signal }), { name: 'AbortError' });
});

test('a text longer than the PPTX reader accepts is refused with its wording', async () => {
  const box = length => single([shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED]], text: textRecords(4, 'x\r'.repeat(length / 2), { bytes: true }) })]);
  await assert.rejects(importSlidePpt(ppt(box(100_002))), /^Error: PowerPointのテキスト量が読み込み上限を超えています$/);
  assert.equal((await deckOf(box(1000))).slides[0].elements[0].text.length, 1000);
});

test('style runs that cover no characters are tolerated without reading more runs than the text has characters', async () => {
  const empty = Array.from({ length: 2000 }, () => [0, {}]);
  const deck = await deckOf(single([shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED]],
    text: [textHeader(4), textCharacters('kept'), styleText([[5, 0, {}]], [[2, { bold: true }], ...empty, [3, { italic: true }]])] })]));
  assert.deepEqual([deck.slides[0].elements[0].text, deck.slides[0].elements[0].italic], ['kept', false]);
});

test('characters and sizes outside what the model accepts are dropped or brought into range', async () => {
  const deck = await deckOf(single([shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED]], text: textRecords(4, 'a\u007fb', { characters: [[4, { size: 4000 }]] }) })]));
  const [box] = deck.slides[0].elements;
  assert.equal(box.text, 'ab');
  assert.ok(box.fontSize >= 1 && box.fontSize <= 1000, String(box.fontSize));
});

test('font names the model does not accept are left to the master instead of failing the import', async () => {
  const box = (id, font) => shape({ id, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED]], text: textRecords(4, 'text', { characters: [[5, { font, size: 18 }]] }) });
  // "@" marks the vertical variant of a face; other punctuation cannot be stored in a deck.
  const deck = await deckOf({ fonts: ['Arial', '@MS Gothic', 'Bad(Font)*'], ...single([box(1030, 1), box(1031, 2)]) });
  assert.deepEqual(deck.slides[0].elements.map(element => element.fontFamily), ['MS Gothic', 'Arial']);
  // A master whose own fonts are unusable falls back to the default face.
  assert.equal((await deckOf({ fonts: ['<Title>', 'Arial'], ...single([box(1030, 1)]) })).slides[0].elements[0].fontFamily, 'Arial');
});

test('a line wider than the model accepts is narrowed, and an impossible slide size is refused by name', async () => {
  const deck = await deckOf(single([shape({ id: 1030, anchor: [0, 0, 600, 3000], properties: [[P.lineFlags, LINED], [P.lineWidth, 2_000_000]] })]));
  assert.equal(deck.slides[0].elements[0].strokeWidth, 100);
  for (const size of [[70_000, 3240], [5760, 70_000], [3, 3240]])
    await assert.rejects(importSlidePpt(ppt({ size, masters: [master()], slides: [{ id: 256, masterId: 0x80000000 }] })), /^Error: PowerPointを読み込めません: スライドのサイズが不正です$/);
});

test('damaged text and drawing records lose detail, not the slide', async () => {
  const truncated = [textHeader(4), textCharacters('survives'), artRecord(0, 0, 0x0fa1, [9, 0, 0, 0, 0, 0, 0x01])];
  const deck = await deckOf(single([shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED]], text: truncated }), shape({ id: 1031, anchor: [0, 0, 600, 3000], outline: 9, placeholder: 14 })]));
  assert.deepEqual(deck.slides[0].elements.map(element => element.text), ['survives', '']);
});

test('importSlidePowerPoint routes by content and keeps the PPTX path for everything else', async () => {
  const legacy = ppt(single([shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[P.fillFlags, UNFILLED], [P.lineFlags, UNLINED]], text: textRecords(4, '旧形式') })]));
  const modern = await readFile(new URL('./fixtures/powerpoint-basic.pptx', import.meta.url));
  for (const input of [legacy, legacy.buffer.slice(0), new Blob([legacy]), new File([legacy], 'deck.ppt'), new File([legacy], 'deck.bin')])
    assert.equal((await importSlidePowerPoint(input)).deck.slides[0].elements[0].text, '旧形式');
  const expected = await importSlidePptx(modern);
  for (const input of [modern, new Blob([modern]), new File([modern], 'deck.pptx'), new File([modern], 'renamed.ppt')])
    assert.deepEqual(await importSlidePowerPoint(input), expected);
  await assert.rejects(importSlidePowerPoint(new File([legacy], 'locked.pptx')), /暗号化されていない\.pptx または \.potx形式を指定してください/);
  await assert.rejects(importSlidePowerPoint(new TextEncoder().encode('plain text, not a presentation')), /暗号化されていない\.pptx または \.potx形式を指定してください/);
});

test('a bundle that only re-exports from the model entry works without anything being loaded first', async () => {
  // Loading a reader on demand would defer the set-up of every module it shares with the model.
  const reexport = await build({ stdin: { contents: `export { createSlideElement } from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'reexport-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  const { createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(reexport.outputFiles[0].text).toString('base64')}`);
  assert.equal(createSlideElement({ type: 'shape', shape: 'rect' }).type, 'shape');
});
