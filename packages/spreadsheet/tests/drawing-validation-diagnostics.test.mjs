import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/model/annotations.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeDrawing } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sheet = { rowCount: 100, columnCount: 20 };
const shape = { id: 'shape-1', type: 'shape', shape: 'roundedRectangle',
  anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 80,
  fill: '#ffffff', stroke: '#000000', strokeWidth: 1, fontSize: 16, cornerRadiusRatio: 0.2 };
const normalize = drawing => normalizeDrawing(drawing, sheet, undefined);
const withField = (field, value) => field.startsWith('anchor.')
  ? { ...shape, anchor: { ...shape.anchor, [field.slice(7)]: value } }
  : { ...shape, [field]: value };
const prefix = '描画オブジェクトのサイズまたは位置が正しくありません';

test('drawing numeric errors identify the field, rejected value and unchanged valid range', () => {
  const fields = [
    ['width', 1, 10000], ['height', 1, 10000], ['anchor.offsetX', 0, 10000], ['anchor.offsetY', 0, 10000],
    ['fontSize', 1, 400], ['strokeWidth', 0, 100], ['cornerRadiusRatio', 0, 0.5],
  ];
  for (const [field, minimum, maximum] of fields) {
    for (const value of [minimum - 1, maximum + 1, NaN, Infinity, -Infinity]) {
      assert.throws(() => normalize(withField(field, value)), {
        message: `${prefix}（${field}: ${String(value)}、許容範囲: ${minimum}〜${maximum}の有限数）`,
      });
    }
    for (const value of [minimum, maximum]) assert.doesNotThrow(() => normalize(withField(field, value)));
  }
});

test('text font size and image dimension errors show their own numeric limits', () => {
  const text = { ...shape, type: 'text', text: 'Caption', fontSize: 0, color: '#000000', background: 'transparent' };
  assert.throws(() => normalize(text), { message: `${prefix}（fontSize: 0、許容範囲: 1〜400の有限数）` });
  const image = { ...shape, type: 'image', width: 0, resourceId: 'image-1', alt: '' };
  assert.throws(() => normalize(image), { message: `${prefix}（width: 0、許容範囲: ${Number.MIN_VALUE}〜10000の有限数）` });
});

test('untrusted nonnumeric values remain rejected without unbounded or executable diagnostics', () => {
  const throwingObject = { toString() { throw new Error('must not be invoked'); } };
  const huge = 'private payload'.repeat(100000);
  const values = [
    ['100', '"100"（string）'], ['', '""（string）'], ['line\ntext', '"line\\ntext"（string）'],
    [huge, `string（${huge.length}文字）`], [undefined, 'undefined'], [null, 'null'],
    [true, 'true'], [false, 'false'], [throwingObject, 'object'], [[], 'array'],
    [Symbol('private payload'), 'symbol'], [BigInt(100), 'bigint'], [() => {}, 'function'],
  ];
  for (const [value, description] of values) {
    assert.throws(() => normalize(withField('width', value)), error => {
      assert.equal(error.message, `${prefix}（width: ${description}、許容範囲: 1〜10000の有限数）`);
      assert.ok(error.message.length < 200, 'diagnostic must stay compact');
      assert.equal(error.message.includes('private payload'), false);
      return true;
    });
  }
});
