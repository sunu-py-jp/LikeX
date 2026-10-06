import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeywordSearchMatcher } from '../src/keyword-search.ts';

test('AND groups fields, OR accepts one keyword, and fragments never join implicitly', () => {
  const and = createKeywordSearchMatcher({ keywords: ['顧客', '会議'] });
  assert.equal(and.test(['顧客一覧', '会議の議事録']), true);
  assert.equal(and.test('顧客一覧'), false);
  assert.equal(and.test(['顧', '客', '会議']), false);
  assert.equal(createKeywordSearchMatcher({ keywords: ['顧客', '会議'], operator: 'or' }).test('会議'), true);
  assert.equal(createKeywordSearchMatcher({ keywords: [] }).test('anything'), false);
});

test('literal offsets retain Unicode, punctuation, duplicates and repeated-use semantics', () => {
  const query = { keywords: ['顧客', 'K', '.*', '顧客'] };
  const matcher = createKeywordSearchMatcher(query);
  query.keywords[0] = 'changed';
  for (let index = 0; index < 2; index++) assert.deepEqual(matcher.find('😀顧客 k .*'), [
    { keyword: '顧客', from: 2, to: 4 }, { keyword: 'K', from: 5, to: 6 }, { keyword: '.*', from: 7, to: 9 },
  ]);
  assert.equal(createKeywordSearchMatcher({ keywords: ['K'], matchCase: true }).test('k'), false);
  assert.equal(createKeywordSearchMatcher({ keywords: ['a b'] }).test('a  b'), false);
  assert.equal(createKeywordSearchMatcher({ keywords: ['abc'] }).test('abcd'), true);
  assert.deepEqual(createKeywordSearchMatcher({ keywords: ['aaa'] }).find('aaaa'), [{ keyword: 'aaa', from: 0, to: 3 }]);
});

test('queries and result budgets reject invalid data explicitly', () => {
  for (const query of [null, {}, {keywords: 'a'}, {keywords: ['']}, {keywords: [1]}, {keywords: Array(1)},
    {keywords: ['x'], operator: 'xor'}, {keywords: ['x'], matchCase: 1}, {keywords:['x'], useRegex:true},
    {keywords:Array(65).fill('x')}, {keywords:['a'.repeat(4097)]}, {keywords:Array(5).fill('a'.repeat(4096))}])
    assert.throws(() => createKeywordSearchMatcher(query));
  const matcher = createKeywordSearchMatcher({keywords:['a']});
  assert.throws(() => matcher.test([1])); assert.throws(() => matcher.find(null));
  assert.throws(() => matcher.find('a'.repeat(10001)), /10,000/);
  assert.equal(matcher.find('a'.repeat(10000)).length, 10000);
  const result = matcher.find('a');
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result[0]), true);
});

test('query snapshots never call getters or array iterators supplied by a caller', () => {
  let called=0;
  assert.throws(()=>createKeywordSearchMatcher({get keywords(){called++;return ['x'];}}));
  const keywords=['x']; keywords[Symbol.iterator]=function*(){called++;yield 'hidden';};
  assert.throws(()=>createKeywordSearchMatcher({keywords}));
  const accessor=[]; Object.defineProperty(accessor,'0',{get(){called++;return 'x';},enumerable:true});
  assert.throws(()=>createKeywordSearchMatcher({keywords:accessor}));
  assert.equal(called,0);
  assert.equal(createKeywordSearchMatcher({keywords:[]}).empty,true);
});
