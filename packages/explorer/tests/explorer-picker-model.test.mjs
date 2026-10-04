import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { resolveExplorerPickerItems } = await importTypeScript('../src/model/picker.ts');
const entry = (id, parent, name, kind = 'file') => ({ id, parent, name, kind, size: kind === 'file' ? 12 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-10-04T01:02:03.000Z', updatedAt: '2026-10-04T04:05:06.000Z', favorite: 0 });
const makeEntries = () => [entry('docs', 'root', '資料', 'folder'), entry('plans', 'docs', '計画', 'folder'),
  entry('readme', 'root', 'README.md'), entry('report', 'plans', '報告.TXT'), entry('summary', 'docs', '概要.csv')];
const entries = Object.freeze(makeEntries().map(value => Object.freeze({ ...value,
  source: value.source ? Object.freeze(value.source) : null })));
const resolve = (ids, options) => resolveExplorerPickerItems(entries, ids, options);
function failure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length);
  assert.equal(Object.hasOwn(result, 'items'), false, 'failure must not expose a partial selection');
  assert.equal(Object.isFrozen(result), true);
}

test('default picker returns one isolated file description with current path and derived extension', () => {
  const result = resolve(['report']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [{ ...entries[3], path: '/資料/計画/報告.TXT', extension: 'txt' }]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.equal(Object.isFrozen(result.items[0].source), true);
  assert.notEqual(result.items[0], entries[3]);
  assert.notEqual(result.items[0].source, entries[3].source);
});

test('single selection deduplicates IDs while multiple preserves first-seen order across folders', () => {
  assert.deepEqual(resolve(['report', 'report']).items.map(item => item.id), ['report']);
  failure(resolve(['readme', 'report']), 'selection-limit');
  const result = resolve(['report', 'readme', 'report', 'summary'], { multiple: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map(item => item.id), ['report', 'readme', 'summary']);
  assert.deepEqual(result.items.map(item => item.path), ['/資料/計画/報告.TXT', '/README.md', '/資料/概要.csv']);
});

test('file, folder and mixed selection rules reject the complete batch on a kind mismatch', () => {
  failure(resolve(['docs']), 'selection-kind');
  failure(resolve(['report'], { kind: 'folder' }), 'selection-kind');
  failure(resolve(['report', 'docs'], { multiple: true }), 'selection-kind');
  failure(resolve(['docs', 'report'], { kind: 'folder', multiple: true }), 'selection-kind');
  assert.deepEqual(resolve(['docs', 'plans'], { kind: 'folder', multiple: true }).items.map(item => item.path), ['/資料', '/資料/計画']);
  assert.deepEqual(resolve(['report', 'docs'], { kind: 'both', multiple: true }).items.map(item => item.kind), ['file', 'folder']);
});

test('root is an explicit folder-like result without invented file metadata', () => {
  failure(resolve(['root']), 'selection-kind');
  assert.deepEqual(resolve(['root'], { kind: 'folder' }), { ok: true, items: [{ kind: 'root', id: 'root', path: '/', name: 'ファイル' }] });
  assert.deepEqual(resolve(['root'], { kind: 'both', rootLabel: '  共有資料  ' }).items[0], { kind: 'root', id: 'root', path: '/', name: '共有資料' });
  assert.equal(resolve(['root'], { kind: 'folder', rootLabel: '   ' }).items[0].name, 'ファイル');
  assert.deepEqual(resolve(['root', 'report', 'root'], { kind: 'both', multiple: true }).items.map(item => item.id), ['root', 'report']);
  assert.deepEqual(resolveExplorerPickerItems([], ['root'], { kind: 'folder' }).items.map(item => item.path), ['/']);
});

test('empty or missing selections cannot confirm and IDs are not paths or case-insensitive names', () => {
  failure(resolve([]), 'empty-selection');
  failure(resolve(['missing']), 'not-found');
  failure(resolve(['report', 'missing'], { multiple: true }), 'not-found');
  for (const id of ['REPORT', '/資料/計画/報告.TXT', '報告.TXT']) failure(resolve([id]), 'not-found');
});

test('malformed ids and options return invalid-target without throwing or evaluating accessors', () => {
  for (const ids of [null, undefined, {}, 'report', [null], [42], [''], ['report', undefined], [, 'report']])
    failure(resolve(ids), 'invalid-target');
  for (const options of [null, [], true, new Map(), { kind: 'image' }, { kind: null }, { multiple: 1 }, { rootLabel: 42 }])
    failure(resolve(['report'], options), 'invalid-target');
  let reads = 0;
  const ids = [];
  Object.defineProperty(ids, '0', { get() { reads++; return 'report'; } });
  failure(resolve(ids), 'invalid-target');
  failure(resolve(['report'], { get kind() { reads++; return 'file'; } }), 'invalid-target');
  failure(resolve(['report'], { get multiple() { reads++; return false; } }), 'invalid-target');
  assert.equal(reads, 0);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  failure(resolve(['report'], revoked.proxy), 'invalid-target');
});

test('broken, cyclic, duplicate and reserved hierarchies are rejected even when only a valid item is selected', () => {
  const invalid = [
    [entry('orphan', 'missing', 'Orphan.txt')],
    [entry('cycle', 'cycle', 'Cycle', 'folder')],
    [entry('a', 'b', 'A', 'folder'), entry('b', 'a', 'B', 'folder')],
    [entry('bad-child', 'readme', 'Child.txt')],
    [entry('report', 'root', 'Duplicate.txt')],
    [entry('root', 'root', 'Invalid root', 'folder')],
    [entry('same-name', 'root', 'readme.MD')],
  ];
  for (const extra of invalid) {
    failure(resolveExplorerPickerItems([...entries, ...extra], ['report']), 'invalid-hierarchy');
    failure(resolveExplorerPickerItems([...entries, ...extra], ['root'], { kind: 'folder' }), 'invalid-hierarchy');
  }
});

test('malformed entry metadata and getters return invalid-hierarchy without reading host accessors', () => {
  for (const value of [null, undefined, {}, [null], [, ...entries], [{ ...entries[0], kind: 'other' }],
    [{ ...entries[2], size: Infinity }], [{ ...entries[2], favorite: -1 }], [{ ...entries[2], mime: null }],
    [{ ...entries[2], source: { kind: 'existing', id: '' } }], [{ ...entries[2], source: { kind: 'local', file: {} } }]])
    failure(resolveExplorerPickerItems(value, ['root'], { kind: 'folder' }), 'invalid-hierarchy');
  let reads = 0;
  failure(resolveExplorerPickerItems([{ ...entries[2], get name() { reads++; return 'A.txt'; } }], ['readme']), 'invalid-hierarchy');
  failure(resolveExplorerPickerItems([{ ...entries[2], source: { kind: 'existing', get id() { reads++; return 'body'; } } }], ['readme']), 'invalid-hierarchy');
  assert.equal(reads, 0);
});

test('a successful response is isolated from later host edits without mutating input data', () => {
  const source = makeEntries(), before = structuredClone(source);
  const ids = Object.freeze(['summary', 'readme']), options = Object.freeze({ kind: 'both', multiple: true });
  const result = resolveExplorerPickerItems(source, ids, options);
  assert.equal(result.ok, true);
  assert.deepEqual(source, before);
  assert.deepEqual(ids, ['summary', 'readme']);
  assert.deepEqual(options, { kind: 'both', multiple: true });
  source[4].name = 'renamed.json'; source[4].parent = 'root'; source[4].source.id = 'new-body';
  assert.equal(result.items[0].path, '/資料/概要.csv');
  assert.equal(result.items[0].source.id, 'body-summary');
  const latest = resolveExplorerPickerItems(source, ['summary']);
  assert.equal(latest.items[0].path, '/renamed.json');
  assert.equal(latest.items[0].extension, 'json');
});

test('local File sources remain usable and the host File is not frozen or read', () => {
  const file = new File(['body'], 'local.txt', { type: 'text/plain' });
  const value = entry('local', 'root', 'local.txt');
  value.source = { kind: 'local', file };
  const result = resolveExplorerPickerItems([value], ['local']);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].source.file, file);
  assert.notEqual(result.items[0].source, value.source);
  assert.equal(Object.isFrozen(file), false);
  assert.equal(Object.isFrozen(value.source), false);
});

test('the React-free public model entry exposes the same resolver', async () => {
  const model = await importTypeScript('../src/model-entry.ts');
  assert.deepEqual(model.resolveExplorerPickerItems(entries, ['report']), resolve(['report']));
});
