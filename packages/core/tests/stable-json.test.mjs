import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeStableJson } from '../src/stable-json.ts';

test('insertion order does not change compact JSON, including nested and numeric-looking keys', () => {
  const left = { z: { b: 1, a: 2 }, cells: { 2: 'two', 10: 'ten' }, a: true };
  const right = { a: true, cells: { 10: 'ten', 2: 'two' }, z: { a: 2, b: 1 } };
  const expected = '{"a":true,"cells":{"10":"ten","2":"two"},"z":{"a":2,"b":1}}';
  assert.equal(serializeStableJson(left), expected);
  assert.equal(serializeStableJson(right), expected);
  assert.deepEqual(JSON.parse(expected), left);
});

test('default keys use UTF-16 order, independently of locale and Unicode code point order', () => {
  assert.equal(serializeStableJson({ '\ue000': 1, '😀': 2, 'ä': 3, z: 4, Z: 5 }),
    '{"Z":5,"z":4,"ä":3,"😀":2,"\ue000":1}');
});

test('arrays, user text, and primitive encodings retain their meaning', () => {
  const text = '\r\n"\\\t\b\f\u0000\u001f\u2028e\u0301é😀\ud800\udfff';
  const values = [3, 1, true, false, null, text, -0, 1e30, 1e-8];
  assert.equal(serializeStableJson(values), JSON.stringify(values));
  assert.equal(serializeStableJson({}), '{}');
  assert.equal(serializeStableJson([]), '[]');
  assert.equal(serializeStableJson(null), 'null');
});

test('undefined object properties are omitted while array holes and undefined become null', () => {
  const sparse = [];
  sparse.length = 3;
  sparse[1] = undefined;
  sparse[2] = { omitted: undefined, present: 1 };
  assert.equal(serializeStableJson({ omitted: undefined, sparse }), '{"sparse":[null,null,{"present":1}]}');
  assert.throws(() => serializeStableJson(undefined), TypeError);
});

test('shared references are supported without mutations, but cycles are rejected', () => {
  const shared = Object.freeze({ b: 2, a: 1 });
  const input = Object.freeze({ z: shared, a: Object.freeze([shared]) });
  assert.equal(serializeStableJson(input), '{"a":[{"a":1,"b":2}],"z":{"a":1,"b":2}}');
  assert.deepEqual(Object.keys(shared), ['b', 'a']);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => serializeStableJson(cycle), /circular/);
  const arrayCycle = [];
  arrayCycle.push(arrayCycle);
  assert.throws(() => serializeStableJson(arrayCycle), /circular/);
});

test('non-JSON values are rejected at the root and when nested instead of silently changing data', () => {
  for (const value of [NaN, Infinity, -Infinity, 1n, Symbol('value'), () => {}, new Date(), new Map(), new Set(), new Uint8Array(1), new (class Example {})()]) {
    assert.throws(() => serializeStableJson(value), TypeError);
    assert.throws(() => serializeStableJson({ nested: value }), TypeError);
    assert.throws(() => serializeStableJson([value]), TypeError);
  }
  assert.throws(() => serializeStableJson({ [Symbol('key')]: true }), TypeError);
  assert.throws(() => serializeStableJson({ toJSON: () => ({ value: 'different' }) }), TypeError);
  const nullPrototype = Object.create(null);
  nullPrototype.b = 2;
  nullPrototype.a = 1;
  assert.equal(serializeStableJson(nullPrototype), '{"a":1,"b":2}');
});

test('maxLength validates its unit and exact inclusive boundary for escaped UTF-16 output', () => {
  for (const maxLength of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20', null]) {
    assert.throws(() => serializeStableJson({}, { maxLength }), RangeError);
  }
  for (const value of ['😀', '\ud800', '\udfff', '\ud800\udfff', '\ud800x\udfff', '\"\\\n\r\b\f\t\u0000\u001f', { key: '😀\ud800' }, [1, 'abc']]) {
    const expected = serializeStableJson(value);
    assert.equal(serializeStableJson(value, { maxLength: expected.length }), expected);
    assert.throws(() => serializeStableJson(value, { maxLength: expected.length - 1 }), RangeError);
  }
  assert.equal(serializeStableJson(1, { maxLength: 1 }), '1');
});

test('large text and many tokens are preserved, with aggregate limits checked before later values', () => {
  const text = 'abcd😀\n'.repeat(20_000);
  const value = { b: Array.from({ length: 10_000 }, (_, index) => index), a: text };
  const expected = serializeStableJson(value);
  assert.deepEqual(JSON.parse(expected), value);
  assert.equal(serializeStableJson(value, { maxLength: expected.length }), expected);
  assert.throws(() => serializeStableJson(value, { maxLength: expected.length - 1 }), RangeError);
  let visited = false;
  const overflow = { a: text, get z() { visited = true; return 1; } };
  assert.throws(() => serializeStableJson(overflow, { maxLength: 100 }), RangeError);
  assert.equal(visited, false);
});

test('a domain comparator orders object keys using immutable paths without reordering arrays', () => {
  const paths = [];
  const input = { sheets: [{ id: 'second', cells: { 10: 'ten', 2: 'two' } }, { id: 'first', cells: { 8: 'eight', 1: 'one' } }] };
  const output = serializeStableJson(input, {
    compareKeys(left, right, path) {
      paths.push(path);
      assert.ok(Object.isFrozen(path));
      if (path.at(-1) === 'cells') return Number(left) - Number(right);
      return 0;
    },
  });
  assert.equal(output, '{"sheets":[{"cells":{"2":"two","10":"ten"},"id":"second"},{"cells":{"1":"one","8":"eight"},"id":"first"}]}');
  assert.ok(paths.some(path => JSON.stringify(path) === '["sheets",0,"cells"]'));
  assert.ok(paths.some(path => JSON.stringify(path) === '["sheets",1,"cells"]'));
  for (const order of [0, NaN, Infinity, -Infinity]) {
    assert.equal(serializeStableJson({ z: 1, a: 2 }, { compareKeys: () => order }), '{"a":2,"z":1}');
  }
});

test('fixed indentation uses LF without a trailing newline and counts toward size limits', () => {
  const input = { z: [], b: {}, a: [1, { z: 2, a: { skip: undefined } }] };
  const expected = '{\n  "a": [\n    1,\n    {\n      "a": {},\n      "z": 2\n    }\n  ],\n  "b": {},\n  "z": []\n}';
  assert.equal(serializeStableJson(input, { space: 2 }), expected);
  assert.equal(serializeStableJson(input, { space: 2, maxLength: expected.length }), expected);
  assert.throws(() => serializeStableJson(input, { space: 2, maxLength: expected.length - 1 }), RangeError);
  assert.equal(serializeStableJson({ missing: undefined }, { space: 2 }), '{}');
  for (const space of [0, 1, 2, 10]) {
    const sortedInput = { a: [{ b: 2 }], c: [] };
    assert.equal(serializeStableJson(sortedInput, { space }), JSON.stringify(sortedInput, null, space));
  }
  for (const space of [-1, 11, NaN, Infinity, 1.5, '2', null]) {
    assert.throws(() => serializeStableJson(input, { space }), RangeError);
  }
});
