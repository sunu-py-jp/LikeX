import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextSearchMatcher } from '../src/text-search.ts';

test('literal search preserves metacharacters, case options and reusable matching', () => {
  const matcher = createTextSearchMatcher({ text: 'A+B[1].' });
  assert.equal(matcher.test('prefix a+b[1]. suffix'), true);
  assert.equal(matcher.test('A+B[1].'), true);
  assert.equal(matcher.test('AAAB1x'), false);
  assert.equal(createTextSearchMatcher({ text: 'A', matchCase: true }).test('a'), false);
  assert.equal(createTextSearchMatcher({ text: 'k' }).test('K'), true);
});

test('whole-text matching groups alternatives and does not accept a trailing newline', () => {
  for (const useRegex of [false, true]) {
    const matcher = createTextSearchMatcher({ text: 'foo', wholeText: true, useRegex });
    assert.equal(matcher.test('FOO'), true);
    assert.equal(matcher.test('foo\n'), false);
    assert.equal(matcher.test('afoo'), false);
    assert.equal(matcher.replace('foo\n', 'bar'), 'foo\n');
  }
  const matcher = createTextSearchMatcher({ text: 'foo|bar', useRegex: true, wholeText: true });
  assert.equal(matcher.test('foobar'), false);
  assert.equal(matcher.test('BAR'), true);
});

test('regex supports groups, alternatives, anchors, Unicode and repetitions', () => {
  const matcher = createTextSearchMatcher({ text: '^(売上|Sales)-[0-9]{4}\\.xlsx$', useRegex: true });
  assert.equal(matcher.test('売上-2026.xlsx'), true);
  assert.equal(matcher.test('SALES-2026.xlsx'), true);
  assert.equal(matcher.test('Sales-26.xlsx'), false);
  assert.equal(createTextSearchMatcher({ text: '\\p{Han}+', useRegex: true }).test('abc漢字'), true);
  assert.equal(createTextSearchMatcher({ text: 'Sales', useRegex: true, matchCase: true }).test('sales'), false);
});

test('invalid and unsupported regex is an explicit error, never an empty result', () => {
  for (const text of ['[', '(', '(?=a)', '(?<=a)b', '(a)\\1']) {
    assert.throws(() => createTextSearchMatcher({ text, useRegex: true }), /正規表現/);
  }
  assert.throws(() => createTextSearchMatcher({ text: 'a'.repeat(4097), useRegex: true }), /4,096/);
  assert.throws(() => createTextSearchMatcher({ text: 'a', matchCase: 'false' }), /設定/);
});

test('replacement text is always literal, including regex captures and empty matches', () => {
  for (const useRegex of [false, true]) {
    const matcher = createTextSearchMatcher({ text: 'a', useRegex });
    assert.equal(matcher.replace('Aa', '$1$&'), '$1$&$1$&');
    assert.equal(matcher.test('aa'), true);
  }
  assert.equal(createTextSearchMatcher({ text: '(a)', useRegex: true }).replace('aa', '$1'), '$1$1');
  assert.equal(createTextSearchMatcher({ text: '^|$', useRegex: true }).replace('😀', '-'), '-😀-');
  assert.equal(createTextSearchMatcher({ text: '', useRegex: true }).test(''), false);
  assert.equal(createTextSearchMatcher({ text: '', useRegex: true }).replace('abc', '-'), 'abc');
});

test('nested quantifiers run without catastrophic backtracking', { timeout: 2000 }, () => {
  const matcher = createTextSearchMatcher({ text: '(a+)+$', useRegex: true });
  assert.equal(matcher.test('a'.repeat(50_000) + '!'), false);
  assert.equal(matcher.replace('a'.repeat(50_000) + '!', 'x'), 'a'.repeat(50_000) + '!');
});

test('repeat expansion is rejected before entering the engine compiler', async t => {
  const { RE2JS } = await import('re2js');
  const compile = t.mock.method(RE2JS, 'compile', () => { throw new Error('compiler must not run'); });
  const large = 'a'.repeat(3000);
  for (const text of [
    `(?:${large}){1000}`,
    `(?i:${large}){1000}?`,
    `(?P<word>${large}){1000}`,
    `prefix|(?:${large}){1000}|suffix`,
    '(?:(?:abcdefghijklmnopqrstuv){10}){100}',
    `(?:${large}){1000,}`,
    `(?:${large})*(?i){1000}`,
    `(?:${large})*\\Q\\E{1000}`,
    `(?:(?:${large}){00}){1000}`,
    `(?:(?:${large}){0,00}){1000}`,
  ]) {
    assert.ok(text.length <= 4096);
    assert.throws(() => createTextSearchMatcher({ text, useRegex: true }), /繰り返し展開/);
  }
  assert.equal(compile.mock.callCount(), 0);
});

test('independent counts add costs without multiplying unrelated repetitions', () => {
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const sequential = createTextSearchMatcher({ text: segments.map(char => `${char}{1000}`).join(''), useRegex: true, wholeText: true });
  assert.equal(sequential.test(segments.map(char => char.repeat(1000)).join('')), true);
  const alternatives = createTextSearchMatcher({ text: segments.map(char => `${char}{1000}`).join('|'), useRegex: true, wholeText: true });
  assert.equal(alternatives.test('h'.repeat(1000)), true);
  assert.equal(createTextSearchMatcher({ text: '(?:ab){10}(?:cd){10}', useRegex: true, wholeText: true }).test('ab'.repeat(10) + 'cd'.repeat(10)), true);
  assert.equal(createTextSearchMatcher({ text: '(?:ab)*\\Q\\E{10}', useRegex: true, wholeText: true }).test('ab'.repeat(10)), true);
  assert.equal(createTextSearchMatcher({ text: '(?:ab)*(?i){10}', useRegex: true, wholeText: true }).test('ab'.repeat(10)), true);
  assert.equal(createTextSearchMatcher({ text: '(?:abc{00}){10}', useRegex: true, wholeText: true }).test('abc{00}'.repeat(10)), true);
});

test('cost scanning respects quotes, escape sequences, classes and group prefixes', () => {
  const literal = '(a{1000}|b{1000})'.repeat(100);
  const quoted = createTextSearchMatcher({ text: `\\Q${literal}\\E`, useRegex: true, wholeText: true });
  assert.equal(quoted.test(literal), true);
  const longLiteral = 'a'.repeat(3000);
  assert.equal(createTextSearchMatcher({ text: `\\Q${longLiteral}\\E{1000}`, useRegex: true, wholeText: true }).test('a'.repeat(3999)), true);
  for (const text of ['(?i)[a-z]{1000}', '[[:alpha:]]{1000}', '\\x{0061}{1000}', '\\x61{1000}', '(?P<word>a{1000})', '(?:a{1000})', '[(){},?|]{1000}']) {
    const matcher = createTextSearchMatcher({ text, useRegex: true, wholeText: true });
    assert.equal(matcher.test(text.includes('[(){') ? '('.repeat(1000) : 'a'.repeat(1000)), true, text);
  }
});

test('syntax and invalid repetition errors still come from RE2JS', async t => {
  const { RE2JS } = await import('re2js');
  const original = RE2JS.compile;
  const compile = t.mock.method(RE2JS, 'compile', function (...args) { return original.apply(this, args); });
  for (const text of ['[', '(?=a)', '(a)\\1', 'a{1001}', '(?:a{1000}){1000}']) {
    assert.throws(() => createTextSearchMatcher({ text, useRegex: true }), /正規表現/);
  }
  // Nested count products exceeding the engine's repeat limit may be rejected
  // earlier by the expansion guard; ordinary unsupported syntax reaches RE2JS.
  assert.ok(compile.mock.callCount() >= 4);
});
